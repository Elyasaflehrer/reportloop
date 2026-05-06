setup-deps:
    @echo "→ Phase 1/4: prerequisites + dependencies"                                                                                    
    @command -v node   >/dev/null || (echo "✗ node not installed"   && exit 1)
    @command -v npm    >/dev/null || (echo "✗ npm not installed"    && exit 1)
    @command -v docker >/dev/null || (echo "✗ docker not installed" && exit 1)
    @echo "  ✓ tools available"
    cd backend && npm install
    cd tests   && npm install
    npm install -D supabase
    @echo "  ✓ dependencies installed"

# Cleans any existing instances first so we always start from fresh state.
setup-infra:
    @command -v docker   >/dev/null || (echo "✗ docker not installed"        && exit 1)
    @command -v supabase >/dev/null || (echo "✗ supabase CLI not available" && exit 1)
    @echo "  Stopping Redis..."
    -@docker rm -f reportloop-redis >/dev/null 2>&1
    @echo "  Stopping Supabase..."
    -@supabase stop --no-backup >/dev/null 2>&1
    @echo "  Wiping Supabase volumes..."
    -@docker volume ls -q --filter "label=com.supabase.cli.project" | xargs -r docker volume rm >/dev/null 2>&1
    @echo "  Starting Redis..."
    docker run -d --name reportloop-redis -p 6379:6379 redis:7
    @echo "  Starting Supabase..."
    supabase start
    @echo "  ✓ Infrastructure ready (config preserved, data fresh)"

# Nuclear infrastructure setup — wipes EVERYTHING including supabase/ config.
# Re-runs supabase init. Use rarely (release prep, after major CLI upgrades,

# or when you suspect config rot).
setup-infra-nuclear:
    @echo "→ infrastructure (FROM SCRATCH — nuking config too)"
    @command -v docker   >/dev/null || (echo "✗ docker not installed"        && exit 1)
    @command -v npx supabase >/dev/null || (echo "✗ supabase CLI not available" && exit 1)
    @echo "  Stopping all project containers..."
    -@docker rm -f reportloop-redis >/dev/null 2>&1
    -@npx supabase stop --no-backup >/dev/null 2>&1
    -@docker ps -aq --filter "name=supabase" | xargs -r docker rm -f >/dev/null 2>&1
    @echo "  Wiping Supabase volumes..."
    -@docker volume ls -q --filter "label=com.supabase.cli.project" | xargs -r docker volume rm >/dev/null 2>&1
    @echo "  Starting Redis..."
    docker run -d --name reportloop-redis -p 6379:6379 redis:7
    @echo "  Starting Supabase..."
    npx supabase start
    npx supabase status --output json
    @echo "  ✓ Infrastructure ready (everything wiped, config regenerated)"

create-local-registry REGISTRY_PORT="5001" REG_NAME="local-registry":
    # Check if registry is already running
    if [[ "$(docker inspect -f '{{ "{{.State.Running}}" }}' {{ REG_NAME }} 2>/dev/null || true)" = 'true' ]]; then \
    	echo "✅ Registry {{ REG_NAME }} is already running on port {{ REGISTRY_PORT }}" ;\
    	echo "Skipping registry creation." ;\
    else \
    	echo "🚀 Starting local registry {{ REG_NAME }} on port {{ REGISTRY_PORT }}..." ;\
    	docker run -d --restart=always -p "127.0.0.1:{{ REGISTRY_PORT }}:5000" --network bridge --name {{ REG_NAME }} registry:2 ;\
    fi

# Defaults to the local Supabase Postgres URL.
# Override with: just setup-schema DATABASE_URL=postgresql://...
setup-schema DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres":
    @echo "→ Apply Prisma schema to the local test DB and regenerate client"                                                                                                          
    cd backend && DATABASE_URL="{{ DATABASE_URL }}" npx prisma db push
    @echo "  ✓ schema applied + Prisma client regenerated"
