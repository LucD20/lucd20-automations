# LucD20 Automations

Personal all-in-one Foundry VTT module (Foundry V14). It replaces a pile of
single-feature modules with one package, organized by category, with every
feature togglable. Generic features work in any system. System-specific extras
are loaded only for that system (PF2e first).

See [docs/PLAN.md](docs/PLAN.md) for decisions, the settings layout, feature
specs and build order.

## Install

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/LucD20/lucd20-automations/releases/latest/download/module.json
```

Updates: every push that bumps `version` in `module.json` creates a GitHub
release automatically (see `.github/workflows/release.yml`). Click
**Update** in Foundry's module list to get it.
