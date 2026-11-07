"""LoRA delta W = (alpha/r) B A, merged before inference; no new dependency."""
import math
import torch
from torch import nn


class LoRALinear(nn.Module):
    def __init__(self, linear, rank=8, alpha=16):
        super().__init__()
        self.base = linear
        self.scale = alpha / rank
        self.a = nn.Parameter(torch.empty(rank, linear.in_features, device=linear.weight.device))
        self.b = nn.Parameter(torch.zeros(linear.out_features, rank, device=linear.weight.device))
        nn.init.kaiming_uniform_(self.a, a=math.sqrt(5))

    def forward(self, x):
        return self.base(x) + (x @ self.a.T @ self.b.T) * self.scale


def install(model, rank=8, alpha=16):
    model.requires_grad_(False)
    selected = []
    for name, module in list(model.named_modules()):
        if isinstance(module, nn.Linear) and name.rsplit(".", 1)[-1] in {
                "q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"}:
            parent, leaf = name.rsplit(".", 1)
            setattr(model.get_submodule(parent), leaf, LoRALinear(module, rank, alpha))
            selected.append(name)
    assert selected
    return selected


def export_state(model, half=True):
    """Create a CPU merged state without changing live optimizer parameters."""
    dtype = torch.float16 if half else torch.float32
    state = {}
    for name, tensor in model.state_dict().items():
        if name.endswith((".a", ".b")) or ".base." in name:
            continue
        # Tied embedding/lm_head are serialized once; load_model restores tying.
        if name == "lm_head.weight" and model.config.tie_word_embeddings:
            continue
        # Keep device copy and cast separate: combined MPS->CPU/half conversion
        # changes subsequent live model outputs on this pinned torch build.
        state[name] = tensor.detach().cpu().to(dtype=dtype).contiguous()
    for name, module in model.named_modules():
        if isinstance(module, LoRALinear):
            weight = module.base.weight.detach().float() + module.scale * (module.b.detach() @ module.a.detach())
            state[name + ".weight"] = weight.cpu().to(dtype=dtype).contiguous()
            if module.base.bias is not None:
                state[name + ".bias"] = module.base.bias.detach().cpu().to(dtype=dtype).contiguous()
    return state
