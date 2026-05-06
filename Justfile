set shell := ["/bin/bash", "-c"]

# Reportloop — local development task runner.
# Run `just` (no args) to list available recipes.
#
# Recipe groups live in `just/` and are imported here. To add a new group:
#   1. Create `just/<group>.just` with the recipes
#   2. Add `import 'just/<group>.just'` below

import 'just/setup.just'
import 'just/docker.just'

# Default — list available recipes
default:
    @just --list
