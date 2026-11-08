// ARPA backoff evaluator: compact successor arrays and hash-indexed histories.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <zlib.h>

struct Edge { uint32_t word; float prob; };
struct Row { uint32_t begin = 0, size = 0; float backoff = 1; };
struct Model {
  std::unordered_map<std::string, uint32_t> ids;
  std::vector<std::string> words;
  std::vector<double> unigram;
  std::unordered_map<uint64_t, Row> rows[4];
  std::vector<Edge> edges[4];
  int order = 0;
  uint32_t unknown = 0;
};
static thread_local std::string error_message;

static uint64_t key(const uint32_t* ids, int n) {
  uint64_t v = 0;
  for (int i = 0; i < n; ++i) v = (v << 16) | ids[i];
  return v;
}

extern "C" {
const char* arpa_error() { return error_message.c_str(); }

Model* arpa_open(const char* path) {
  Model* m = new Model();
  gzFile f = gzopen(path, "rb");
  if (!f) { error_message = "Cannot open ARPA"; delete m; return nullptr; }
  try {
    char buffer[16384];
    int section = 0;
    while (gzgets(f, buffer, sizeof(buffer))) {
      std::string line(buffer);
      if (!line.empty() && line[0] == '\\') {
        if (line.size() > 2 && line[1] >= '1' && line[1] <= '4' && line.find("-grams:") != std::string::npos) {
          section = line[1] - '0';
          m->order = std::max(m->order, section);
        } else section = 0;
        continue;
      }
      if (!section || line.empty() || line[0] == '\n' || line[0] == '\r') continue;
      std::istringstream in(line);
      double logprob, logbackoff = 0;
      if (!(in >> logprob)) continue;
      uint32_t ws[4];
      for (int i = 0; i < section; ++i) {
        std::string word;
        if (!(in >> word)) throw std::runtime_error("Malformed ARPA word list");
        if (section == 1) {
          if (m->words.size() >= 65536) throw std::runtime_error("ARPA vocabulary exceeds 16-bit key limit");
          if (m->ids.count(word)) throw std::runtime_error("Duplicate unigram");
          ws[i] = (uint32_t)m->words.size();
          m->ids.emplace(word, ws[i]);
          m->words.push_back(word);
          m->unigram.push_back(std::pow(10.0, logprob));
        } else {
          auto it = m->ids.find(word);
          if (it == m->ids.end()) throw std::runtime_error("N-gram word lacks unigram");
          ws[i] = it->second;
        }
      }
      if (section > 1) {
        Row& r = m->rows[section - 1][key(ws, section - 1)];
        auto& es = m->edges[section - 1];
        if (!r.size) r.begin = (uint32_t)es.size();
        if (r.begin + r.size != es.size()) throw std::runtime_error("ARPA histories are not contiguous");
        es.push_back({ws[section - 1], (float)std::pow(10.0, logprob)});
        ++r.size;
      }
      if (section < 4 && in >> logbackoff)
        m->rows[section][key(ws, section)].backoff = (float)std::pow(10.0, logbackoff);
    }
    int zerr;
    gzerror(f, &zerr);
    if (zerr != Z_OK && zerr != Z_STREAM_END) throw std::runtime_error("gzip read failure");
    gzclose(f); f = nullptr;
    if (m->order < 1 || !m->ids.count("<unk>")) throw std::runtime_error("Missing ARPA unigrams/<unk>");
    m->unknown = m->ids.at("<unk>");
    return m;
  } catch (const std::exception& e) {
    error_message = e.what(); if (f) gzclose(f); delete m; return nullptr;
  }
}

uint32_t arpa_size(Model* m) { return (uint32_t)m->words.size(); }
int arpa_order(Model* m) { return m->order; }
uint32_t arpa_lookup(Model* m, const char* word) {
  auto it = m->ids.find(word); return it == m->ids.end() ? m->unknown : it->second;
}
const char* arpa_word(Model* m, uint32_t i) { return m->words.at(i).c_str(); }
void arpa_close(Model* m) { delete m; }

void arpa_fill(Model* m, const uint32_t* history, int nh, double* out) {
  std::copy(m->unigram.begin(), m->unigram.end(), out);
  for (int n = 1; n <= std::min(nh, m->order - 1); ++n) {
    auto it = m->rows[n].find(key(history + nh - n, n));
    if (it == m->rows[n].end()) continue;
    const Row& row = it->second;
    for (size_t w = 0; w < m->words.size(); ++w) out[w] *= row.backoff;
    for (uint32_t j = row.begin; j < row.begin + row.size; ++j) {
      const Edge& e = m->edges[n][j]; out[e.word] = e.prob;
    }
  }
}
}
