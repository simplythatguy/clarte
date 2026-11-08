"""Native ARPA backoff loader; unknown mass is shared across candidate OOVs."""
from __future__ import annotations

import ctypes as ct
from .paths import library

import numpy as np



class Arpa:
    def __init__(self, path, words):
        self.lib = lib = ct.CDLL(str(library("arpa_native")))
        lib.arpa_open.argtypes = [ct.c_char_p]
        lib.arpa_open.restype = ct.c_void_p
        lib.arpa_error.restype = ct.c_char_p
        lib.arpa_lookup.argtypes = [ct.c_void_p, ct.c_char_p]
        lib.arpa_lookup.restype = ct.c_uint32
        lib.arpa_size.argtypes = [ct.c_void_p]
        lib.arpa_size.restype = ct.c_uint32
        lib.arpa_order.argtypes = [ct.c_void_p]
        lib.arpa_order.restype = ct.c_int
        lib.arpa_close.argtypes = [ct.c_void_p]
        lib.arpa_fill.argtypes = [ct.c_void_p, ct.POINTER(ct.c_uint32), ct.c_int, ct.POINTER(ct.c_double)]
        self.model = lib.arpa_open(str(path).encode())
        if not self.model:
            raise ValueError(lib.arpa_error().decode())
        self.order = lib.arpa_order(self.model)
        self.size = lib.arpa_size(self.model)
        self.unknown = self.lookup("<unk>")
        self.bos = self.lookup("<s>")
        self.ids = np.array([self.lookup(w) for w in words], dtype=np.int32)
        self.oov = self.ids == self.unknown
        self.scratch = np.zeros(self.size, dtype=np.float64)

    def lookup(self, word):
        return self.lib.arpa_lookup(self.model, word.encode())

    def raw_distribution(self, message):
        # ARPA uses one real sentence-start symbol; never concatenate partner turns.
        history = [self.bos] + [self.lookup(w) for w in message[-(self.order - 1):]]
        h = np.array(history[-(self.order - 1):], dtype=np.uint32)
        self.lib.arpa_fill(self.model, h.ctypes.data_as(ct.POINTER(ct.c_uint32)), len(h),
                           self.scratch.ctypes.data_as(ct.POINTER(ct.c_double)))
        return self.scratch

    def distribution(self, message):
        p = self.raw_distribution(message)[self.ids].copy()
        if self.oov.any():
            p[self.oov] /= self.oov.sum()
        return p / p.sum()

    def close(self):
        if self.model:
            self.lib.arpa_close(self.model)
            self.model = None

    def __del__(self):
        if hasattr(self, "model"):
            self.close()
