// Sparse minimum-cost assignment for the ghost/chooser resources.
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <queue>
#include <utility>
#include <vector>

struct Edge { int to, reverse, capacity; double cost; };
using Graph = std::vector<std::vector<Edge>>;

static void edge(Graph &g, int a, int b, int cap, double cost) {
    int ar = static_cast<int>(g[a].size()), br = static_cast<int>(g[b].size());
    g[a].push_back({b, br, cap, cost});
    g[b].push_back({a, ar, 0, -cost});
}

// Prefix paths contain each word's prefixes, INCLUDING its full code.
// terminal[i] is the resource index for the word's full code.
// Output ghost[j] is the selected local word index, or -1.
extern "C" double ghost_assignment(int n, int prefixes, int terminals, int depth,
                                   const int *offsets, const int *paths,
                                   const int *terminal, const double *prob,
                                   int *ghost) {
    const int words_start = 1, ghost_start = 1 + n;
    const int page_start = ghost_start + prefixes;
    const int sink = page_start + 3 * terminals, vertices = sink + 1;
    Graph graph(vertices);
    for (int j = 0; j < prefixes; ++j) {
        ghost[j] = -1;
        edge(graph, ghost_start + j, sink, 1, 0);
    }
    for (int j = 0; j < terminals; ++j) {
        edge(graph, page_start + 3*j, sink, 3, 0);
        edge(graph, page_start + 3*j + 1, sink, 4, 0);
        edge(graph, page_start + 3*j + 2, sink, 4, 0);
    }
    for (int i = 0; i < n; ++i) {
        int word = words_start + i, suffix = offsets[i+1] - offsets[i] - 1;
        int length = suffix + depth;
        edge(graph, 0, word, 1, 0);
        for (int k = 0; k <= suffix; ++k)
            edge(graph, word, ghost_start + paths[offsets[i] + k], 1, prob[i] * (depth+k+2));
        for (int page = 0; page < 3; ++page)
            edge(graph, word, page_start + 3*terminal[i] + page, 1, prob[i] * (length+2+page));
        edge(graph, word, sink, 1, prob[i] * (2*length+5));
    }
    const double infinity = std::numeric_limits<double>::infinity();
    std::vector<double> potential(vertices, 0), distance(vertices);
    std::vector<int> parent(vertices), parent_edge(vertices);
    double total = 0;
    for (int flow = 0; flow < n; ++flow) {
        std::fill(distance.begin(), distance.end(), infinity);
        distance[0] = 0;
        using Item = std::pair<double, int>;
        std::priority_queue<Item, std::vector<Item>, std::greater<Item>> queue;
        queue.push({0, 0});
        while (!queue.empty()) {
            auto [d, v] = queue.top(); queue.pop();
            if (d > distance[v]) continue;
            for (int j = 0; j < static_cast<int>(graph[v].size()); ++j) {
                const Edge &e = graph[v][j];
                if (!e.capacity) continue;
                double nd = d + std::max(0.0, e.cost + potential[v] - potential[e.to]);
                if (nd < distance[e.to]) {
                    distance[e.to] = nd; parent[e.to] = v; parent_edge[e.to] = j;
                    queue.push({nd, e.to});
                }
            }
        }
        if (!std::isfinite(distance[sink])) return infinity;
        for (int v = 0; v < vertices; ++v)
            if (std::isfinite(distance[v])) potential[v] += distance[v];
        for (int v = sink; v != 0; v = parent[v]) {
            Edge &e = graph[parent[v]][parent_edge[v]];
            total += e.cost;
            --e.capacity; ++graph[v][e.reverse].capacity;
        }
    }
    for (int i = 0; i < n; ++i)
        for (const Edge &e : graph[words_start + i])
            if (e.to >= ghost_start && e.to < page_start && !e.capacity)
                ghost[e.to - ghost_start] = i;
    return total;
}
