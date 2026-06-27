#!/usr/bin/env bash
# =============================================================================
# dev.sh — Exchange Engine development helper
# Usage:  ./scripts/dev.sh <command>
#
# Commands:
#   start   Build and start the engine (background)
#   stop    Stop the running engine
#   restart Rebuild and restart
#   logs    Tail live logs
#   build   Build binary only (no run)
#   test    Run full API test suite against running engine
#   clean   Remove binary, DB, logs
#   status  Show whether engine is running + basic health check
# =============================================================================

set -euo pipefail

BINARY="./exchange-engine"
PID_FILE="/tmp/exchange-engine.pid"
LOG_FILE="/tmp/exchange-engine.log"
DB_PATH="/tmp/exchange-engine-dev.db"
PORT="${PORT:-8080}"
BASE_URL="http://localhost:${PORT}"
JWT_SECRET="${JWT_SECRET:-dev-secret-key}"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC} $*"; }
success() { echo -e "${GREEN}[ok]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
error()   { echo -e "${RED}[err]${NC}  $*"; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }

# ── helpers ───────────────────────────────────────────────────────────────────
is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

wait_ready() {
  local tries=0
  info "waiting for engine to be ready..."
  until curl -sf "${BASE_URL}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [[ $tries -ge 20 ]]; then
      error "engine did not start within 10s"
      tail -20 "$LOG_FILE" 2>/dev/null
      exit 1
    fi
    sleep 0.5
  done
  success "engine is ready on :${PORT}"
}

# ── commands ──────────────────────────────────────────────────────────────────

cmd_build() {
  header "Building exchange-engine"
  go build -o "$BINARY" ./cmd/server
  success "binary built → ${BINARY}"
}

cmd_start() {
  if is_running; then
    warn "engine already running (pid $(cat "$PID_FILE")). Use 'restart' to rebuild."
    return
  fi
  cmd_build
  header "Starting exchange-engine"
  DB_PATH="$DB_PATH" PORT="$PORT" JWT_SECRET="$JWT_SECRET" \
    "$BINARY" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  info "pid $(cat "$PID_FILE") | log: ${LOG_FILE}"
  wait_ready
}

cmd_stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
    success "engine stopped"
  else
    warn "engine is not running"
  fi
}

cmd_restart() {
  cmd_stop || true
  sleep 0.5
  cmd_start
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    warn "no log file found at ${LOG_FILE}"
    exit 1
  fi
  tail -f "$LOG_FILE"
}

cmd_clean() {
  cmd_stop 2>/dev/null || true
  rm -f "$BINARY" "$LOG_FILE" "$DB_PATH"
  success "cleaned binary, log, and dev DB"
}

cmd_status() {
  header "Engine status"
  if is_running; then
    success "running (pid $(cat "$PID_FILE"))"
    echo -e "  Health:  $(curl -sf "${BASE_URL}/health" | python3 -m json.tool 2>/dev/null || echo 'unreachable')"
  else
    warn "not running"
  fi
}

# ── test suite ────────────────────────────────────────────────────────────────

PASS=0; FAIL=0

assert() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    success "$label"
    PASS=$((PASS+1))
  else
    error "$label"
    echo "  expected to contain: $expected"
    echo "  got: $actual"
    FAIL=$((FAIL+1))
  fi
}

cmd_test() {
  header "API Test Suite"

  if ! curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
    error "engine not running — start it first with: ./scripts/dev.sh start"
    exit 1
  fi

  # ── Health ──────────────────────────────────────────────────────────────────
  header "Health & Symbols"
  R=$(curl -sf "${BASE_URL}/health")
  assert "GET /health returns ok" '"status":"ok"' "$R"

  R=$(curl -sf "${BASE_URL}/api/symbols")
  assert "GET /api/symbols returns BTC-USD" "BTC-USD" "$R"
  assert "GET /api/symbols returns ETH-USD" "ETH-USD" "$R"
  assert "GET /api/symbols returns SOL-USD" "SOL-USD" "$R"

  # ── Auth ────────────────────────────────────────────────────────────────────
  header "Auth — Register & Login"
  local TS
  TS=$(date +%s)

  REG=$(curl -sf -X POST "${BASE_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"testuser_${TS}\",\"password\":\"pass123\"}")
  assert "POST /api/auth/register returns token" '"token"' "$REG"
  assert "POST /api/auth/register returns user_id" '"user_id"' "$REG"

  TOKEN=$(echo "$REG" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null)

  # duplicate register should 409
  R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"testuser_${TS}\",\"password\":\"x\"}")
  assert "duplicate register returns 409" "409" "$R"

  # login with wrong password should 401
  R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"testuser_${TS}\",\"password\":\"wrong\"}")
  assert "login with wrong password returns 401" "401" "$R"

  R=$(curl -sf -X POST "${BASE_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"testuser_${TS}\",\"password\":\"pass123\"}")
  assert "POST /api/auth/login returns token" '"token"' "$R"

  # ── Portfolio ───────────────────────────────────────────────────────────────
  header "Portfolio"
  R=$(curl -sf "${BASE_URL}/api/portfolio" -H "Authorization: Bearer $TOKEN")
  assert "GET /api/portfolio returns 100k cash" '"cash":100000' "$R"
  assert "GET /api/portfolio has total_value"    '"total_value"' "$R"

  # no token → 401
  R=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/portfolio")
  assert "GET /api/portfolio without token returns 401" "401" "$R"

  # ── Order Book ──────────────────────────────────────────────────────────────
  header "Market Data"
  R=$(curl -sf "${BASE_URL}/api/orderbook/BTC-USD")
  assert "GET /api/orderbook/BTC-USD has bids" '"bids"' "$R"
  assert "GET /api/orderbook/BTC-USD has asks" '"asks"' "$R"

  R=$(curl -sf "${BASE_URL}/api/ticker/BTC-USD")
  assert "GET /api/ticker/BTC-USD has last_price" '"last_price"' "$R"
  assert "GET /api/ticker/BTC-USD has vwap"       '"vwap"'       "$R"

  # wait a moment for GBM to generate candles
  sleep 2
  R=$(curl -sf "${BASE_URL}/api/ohlcv/BTC-USD?interval=1s&limit=10")
  assert "GET /api/ohlcv has candles array" '"candles"' "$R"

  R=$(curl -sf "${BASE_URL}/api/trades/BTC-USD?limit=10")
  assert "GET /api/trades has trades array" '"trades"' "$R"

  # ── Orders ──────────────────────────────────────────────────────────────────
  header "Order Submission"

  # Market BUY
  R=$(curl -sf -X POST "${BASE_URL}/api/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"BTC-USD","side":"BUY","type":"MARKET","quantity":0.05}')
  assert "MARKET BUY filled" '"status":"FILLED"' "$R"

  # Limit BUY (rests in book)
  R=$(curl -sf -X POST "${BASE_URL}/api/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"BTC-USD","side":"BUY","type":"LIMIT","quantity":0.1,"price":1000}')
  assert "LIMIT BUY accepted" '"status"' "$R"
  ORDER_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['order_id'])" 2>/dev/null)

  # List open orders
  R=$(curl -sf "${BASE_URL}/api/orders" -H "Authorization: Bearer $TOKEN")
  assert "GET /api/orders returns orders array" '"orders"' "$R"

  # Cancel the limit order
  R=$(curl -sf -X DELETE "${BASE_URL}/api/orders/${ORDER_ID}?symbol=BTC-USD" \
    -H "Authorization: Bearer $TOKEN")
  assert "DELETE /api/orders/:id cancels order" '"CANCELLED"' "$R"

  # Market SELL (short)
  R=$(curl -sf -X POST "${BASE_URL}/api/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"ETH-USD","side":"SELL","type":"MARKET","quantity":0.5}')
  assert "MARKET SELL (short) accepted" '"order_id"' "$R"

  # Stop-Limit order
  R=$(curl -sf -X POST "${BASE_URL}/api/orders" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"SOL-USD","side":"BUY","type":"STOP_LIMIT","quantity":1,"price":160,"stop_price":155}')
  assert "STOP_LIMIT order accepted" '"order_id"' "$R"

  # ── Portfolio after trades ───────────────────────────────────────────────────
  header "Portfolio After Trades"
  R=$(curl -sf "${BASE_URL}/api/portfolio" -H "Authorization: Bearer $TOKEN")
  assert "portfolio has BTC-USD position" "BTC-USD" "$R"
  assert "portfolio cash decreased" '"cash"' "$R"

  # ── Leaderboard ─────────────────────────────────────────────────────────────
  header "Leaderboard"
  R=$(curl -sf "${BASE_URL}/api/leaderboard" -H "Authorization: Bearer $TOKEN")
  assert "GET /api/leaderboard returns entries" '"leaderboard"' "$R"
  SYS_COUNT=$(echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(len([e for e in d['leaderboard'] if e['user_id']=='market_system']))" 2>/dev/null)
  if [[ "$SYS_COUNT" -eq 0 ]]; then
    success "market_system excluded from leaderboard"
    PASS=$((PASS+1))
  else
    error "market_system still appears in leaderboard"
    FAIL=$((FAIL+1))
  fi

  # ── GBM Throughput ──────────────────────────────────────────────────────────
  header "GBM Throughput"
  sleep 3
  R=$(curl -sf "${BASE_URL}/api/trades/BTC-USD?limit=200")
  COUNT=$(echo "$R" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['trades']))" 2>/dev/null)
  info "BTC-USD trades in store: ${COUNT}"
  if [[ "$COUNT" -ge 10 ]]; then
    success "GBM is generating trades (${COUNT} in ring buffer)"
    PASS=$((PASS+1))
  else
    error "GBM throughput low: only ${COUNT} trades"
    FAIL=$((FAIL+1))
  fi

  # ── Summary ─────────────────────────────────────────────────────────────────
  header "Results"
  echo -e "  ${GREEN}PASSED: ${PASS}${NC}"
  if [[ "$FAIL" -gt 0 ]]; then
    echo -e "  ${RED}FAILED: ${FAIL}${NC}"
    exit 1
  else
    success "All ${PASS} tests passed"
  fi
}

# ── entrypoint ────────────────────────────────────────────────────────────────

CMD="${1:-help}"

case "$CMD" in
  start)   cmd_start   ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  logs)    cmd_logs    ;;
  build)   cmd_build   ;;
  test)    cmd_test    ;;
  clean)   cmd_clean   ;;
  status)  cmd_status  ;;
  *)
    echo -e "${BOLD}Exchange Engine Dev Script${NC}"
    echo ""
    echo "Usage: ./scripts/dev.sh <command>"
    echo "" ✅ COMPLETE
    echo "Commands:"
    echo "  start    Build and start engine in background"
    echo "  stop     Stop running engine"
    echo "  restart  Rebuild and restart"
    echo "  logs     Tail live logs"
    echo "  build    Build binary only"
    echo "  test     Run full API test suite (engine must be running)"
    echo "  clean    Remove binary, log file, dev DB"
    echo "  status   Show running status + health"
    echo ""
    echo "Env vars (optional):"
    echo "  PORT=${PORT}   DB_PATH=${DB_PATH}"
    ;;
esac
