# LucD20 Automations

Personal all-in-one Foundry VTT module (Foundry V14). It replaces a pile of
single-feature modules with one package, organized by category, with every
feature togglable. Generic features work in any system. System-specific extras
are loaded only for that system (PF2e first).

See [docs/PLAN.md](docs/PLAN.md) for decisions, the settings layout, feature
specs and build order.

## Install

### Option A: manifest URL (stable releases)

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/LucD20/lucd20-automations/releases/latest/download/module.json
```

This needs at least one published GitHub release. To publish one, go to
**Releases → Draft a new release** on GitHub, create a tag like `v0.1.0`, and
publish it. The `Release` workflow builds `module.zip` and attaches it.
Foundry's update button then picks up newer releases.

### Option B: git clone (development, fastest loop)

Clone straight into your Foundry data folder. The folder name must be
`lucd20-automations`:

```bash
cd <FoundryData>/Data/modules
git clone -b claude/festive-rubin-k6d8t0 https://github.com/LucD20/lucd20-automations.git
```

To update, run `git pull` in that folder and reload Foundry (F5).

Don't use both options at once: they install to the same folder.
