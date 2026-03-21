#!/usr/bin/env bash
# =============================================================================
# Smart Grid Load Balancer — End-to-End Validation Script
# Requires: curl, jq
# Usage: ./test_grid_flow.sh
# =============================================================================

BASE="http://localhost:3000"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

section() { echo -e "\n${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}"; }
pass()    { echo -e "  ${GREEN}✓ PASS${NC}  $1"; ((PASS++)); }
fail()    { echo -e "  ${RED}✗ FAIL${NC}  $1"; ((FAIL++)); }
info()    { echo -e "  ${YELLOW}→${NC} $1"; }

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then pass "$label (HTTP $actual)";
  else fail "$label — expected HTTP $expected, got $actual"; fi
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then pass "$label";
  else fail "$label — expected '$expected', got '$actual'"; fi
}

# ── Health check ──────────────────────────────────────────────────────────────
section "0. HEALTH CHECK"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
assert_status "API is up" "200" "$STATUS"

# ── Reset — wipe any leftover state from previous runs ────────────────────────
section "0b. PRE-TEST RESET"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/reset")
assert_status "Database wiped clean before test run" "200" "$STATUS"

# ── Setup ─────────────────────────────────────────────────────────────────────
section "1. SETUP — Create Nodes & Solar Source"

# Node A: Hospital (Priority 1)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/nodes" \
  -H "Content-Type: application/json" \
  -d '{"name":"City Hospital","priority_level":1,"max_load_capacity":500}')
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Create Hospital node (Priority 1)" "201" "$STATUS"
NODE_A_ID=$(echo "$BODY" | jq -r '.id')
info "Hospital Node ID: $NODE_A_ID"

# Node B: Residential (Priority 2)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/nodes" \
  -H "Content-Type: application/json" \
  -d '{"name":"Green Valley Residential","priority_level":2,"max_load_capacity":300}')
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Create Residential node (Priority 2)" "201" "$STATUS"
NODE_B_ID=$(echo "$BODY" | jq -r '.id')
info "Residential Node ID: $NODE_B_ID"

# Solar Source (200 kW)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/sources" \
  -H "Content-Type: application/json" \
  -d '{"source_type":"Solar","current_output":200,"status":"Active"}')
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Create Solar source (200 kW)" "201" "$STATUS"
SOURCE_ID=$(echo "$BODY" | jq -r '.id')
info "Solar Source ID: $SOURCE_ID"

# Duplicate name check
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/nodes" \
  -H "Content-Type: application/json" \
  -d '{"name":"City Hospital","priority_level":3,"max_load_capacity":100}')
STATUS=$(echo "$RESP" | tail -1)
assert_status "Duplicate node name is rejected" "409" "$STATUS"

# ── Simulation ────────────────────────────────────────────────────────────────
section "2. SIMULATION — Add Consumers Until Demand Exceeds Solar Output"

# Node A consumers (total: 130 kW)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/consumers" \
  -H "Content-Type: application/json" \
  -d "{\"node_id\":\"$NODE_A_ID\",\"type\":\"Building\",\"current_demand\":100}")
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Add Building (100 kW) to Hospital" "201" "$STATUS"
C_A1_ID=$(echo "$BODY" | jq -r '.id')

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/consumers" \
  -H "Content-Type: application/json" \
  -d "{\"node_id\":\"$NODE_A_ID\",\"type\":\"EV_Charger\",\"current_demand\":30}")
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Add EV_Charger (30 kW) to Hospital" "201" "$STATUS"
C_A2_ID=$(echo "$BODY" | jq -r '.id')

# Verify Hospital total_demand = 130
NODE_A=$(curl -s "$BASE/nodes/$NODE_A_ID")
NODE_A_DEMAND=$(echo "$NODE_A" | jq -r '.total_demand')
assert_eq "Hospital total_demand = 130" "130" "$NODE_A_DEMAND"

# Node B consumers (total: 90 kW)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/consumers" \
  -H "Content-Type: application/json" \
  -d "{\"node_id\":\"$NODE_B_ID\",\"type\":\"Streetlight\",\"current_demand\":20}")
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Add Streetlight (20 kW) to Residential" "201" "$STATUS"
C_B1_ID=$(echo "$BODY" | jq -r '.id')

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/consumers" \
  -H "Content-Type: application/json" \
  -d "{\"node_id\":\"$NODE_B_ID\",\"type\":\"Building\",\"current_demand\":90}")
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Add Building (90 kW) to Residential" "201" "$STATUS"
C_B2_ID=$(echo "$BODY" | jq -r '.id')

# Verify Residential total_demand = 110
NODE_B=$(curl -s "$BASE/nodes/$NODE_B_ID")
NODE_B_DEMAND=$(echo "$NODE_B" | jq -r '.total_demand')
assert_eq "Residential total_demand = 110" "110" "$NODE_B_DEMAND"

# Total demand (130 + 110 = 240) > Solar (200 kW) — system is overloaded
TOTAL_DEMAND=$((NODE_A_DEMAND + NODE_B_DEMAND))
info "Combined demand: ${TOTAL_DEMAND} kW vs Solar: 200 kW → grid overloaded"
if (( TOTAL_DEMAND > 200 )); then pass "Total demand (${TOTAL_DEMAND} kW) exceeds Solar output (200 kW)";
else fail "Expected total demand to exceed 200 kW"; fi

# Source fluctuation: cloud cover drops Solar to 80 kW
RESP=$(curl -s -w "\n%{http_code}" -X PUT "$BASE/sources/$SOURCE_ID" \
  -H "Content-Type: application/json" \
  -d '{"current_output":80}')
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Fluctuate Solar output to 80 kW (cloud cover)" "200" "$STATUS"
NEW_OUTPUT=$(echo "$BODY" | jq -r '.current_output')
assert_eq "Solar current_output updated to 80" "80" "$NEW_OUTPUT"

# ── Stability Check ───────────────────────────────────────────────────────────
section "3. STABILITY CHECK — Verify Grid Logs Are Recorded"

# Trigger a new log by updating a consumer
curl -s -o /dev/null -X PUT "$BASE/consumers/$C_A1_ID" \
  -H "Content-Type: application/json" \
  -d '{"current_demand":105}'

# Verify Hospital demand updated to 135 and log exists
NODE_A=$(curl -s "$BASE/nodes/$NODE_A_ID")
UPDATED_DEMAND=$(echo "$NODE_A" | jq -r '.total_demand')
assert_eq "Hospital total_demand updated to 135 after consumer change" "135" "$UPDATED_DEMAND"

LOGS=$(curl -s "$BASE/nodes/$NODE_A_ID/logs")
LOG_COUNT=$(echo "$LOGS" | jq '.logs | length')
if (( LOG_COUNT > 0 )); then
  pass "Hospital has $LOG_COUNT stability log entries"
  LATEST_LOG=$(echo "$LOGS" | jq '.logs[0]')
  SCORE=$(echo "$LATEST_LOG" | jq -r '.stability_score')
  SUPPLY=$(echo "$LATEST_LOG" | jq -r '.total_supply')
  info "Latest log → total_supply: ${SUPPLY} kW, stability_score: ${SCORE}"
  # With 80kW supply and 135kW demand, stability < 100
  STABLE=$(echo "$SCORE < 100" | bc -l 2>/dev/null || python3 -c "print(1 if $SCORE < 100 else 0)")
  if [[ "$STABLE" == "1" ]]; then pass "Stability score (${SCORE}) < 100 — correctly reflects overload";
  else fail "Expected stability_score < 100 under overload"; fi
else
  fail "No grid log entries found for Hospital node"
fi

# Global log summary
SUMMARY=$(curl -s "$BASE/logs/summary")
SUMMARY_COUNT=$(echo "$SUMMARY" | jq 'length')
if (( SUMMARY_COUNT >= 2 )); then pass "Global log summary returns data for $SUMMARY_COUNT nodes";
else fail "Global log summary returned fewer entries than expected"; fi

# ── Isolation Test ────────────────────────────────────────────────────────────
section "4. ISOLATION TEST — Node A Changes Must Not Affect Node B Totals"

# Record Node B demand before touching Node A
NODE_B_BEFORE=$(curl -s "$BASE/nodes/$NODE_B_ID" | jq -r '.total_demand')
info "Node B demand before touching Node A: ${NODE_B_BEFORE} kW"

# Modify a consumer in Node A
curl -s -o /dev/null -X PUT "$BASE/consumers/$C_A2_ID" \
  -H "Content-Type: application/json" \
  -d '{"current_demand":50}'

# Node A demand should change (was 135, now 155)
NODE_A_AFTER=$(curl -s "$BASE/nodes/$NODE_A_ID" | jq -r '.total_demand')
assert_eq "Hospital demand updated to 155 after EV_Charger increase" "155" "$NODE_A_AFTER"

# Node B demand must remain exactly the same
NODE_B_AFTER=$(curl -s "$BASE/nodes/$NODE_B_ID" | jq -r '.total_demand')
assert_eq "Residential demand unchanged after Node A modification" "$NODE_B_BEFORE" "$NODE_B_AFTER"

# ── Cleanup ───────────────────────────────────────────────────────────────────
section "5. CLEANUP — Delete Constraints & Successful Cleanup"

# Try deleting Node A while it has active consumers → must fail
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/nodes/$NODE_A_ID")
STATUS=$(echo "$RESP" | tail -1)
assert_status "Cannot delete Hospital node with active consumers" "409" "$STATUS"

# Try deleting Node B while it has active consumers → must fail
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/nodes/$NODE_B_ID")
STATUS=$(echo "$RESP" | tail -1)
assert_status "Cannot delete Residential node with active consumers" "409" "$STATUS"

# Remove all consumers from Node B then delete it
curl -s -o /dev/null -X DELETE "$BASE/consumers/$C_B1_ID"
curl -s -o /dev/null -X DELETE "$BASE/consumers/$C_B2_ID"

RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/nodes/$NODE_B_ID")
STATUS=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -1)
assert_status "Delete empty Residential node succeeds" "200" "$STATUS"

# Confirm Node B is gone
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nodes/$NODE_B_ID")
assert_status "Deleted node returns 404" "404" "$STATUS"

# Node A still has consumers — should still exist
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nodes/$NODE_A_ID")
assert_status "Hospital node (with consumers) still exists" "200" "$STATUS"

# Deactivate (not delete) a consumer and verify demand recalculates
curl -s -o /dev/null -X PUT "$BASE/consumers/$C_A1_ID" \
  -H "Content-Type: application/json" \
  -d '{"is_active":0}'
NODE_A_INACTIVE=$(curl -s "$BASE/nodes/$NODE_A_ID" | jq -r '.total_demand')
assert_eq "Hospital demand drops when consumer deactivated (Building 105kW inactive → 50 kW remain)" "50" "$NODE_A_INACTIVE"

# Clean up source
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/sources/$SOURCE_ID")
STATUS=$(echo "$RESP" | tail -1)
assert_status "Delete Solar source" "200" "$STATUS"

# ── Summary ───────────────────────────────────────────────────────────────────
section "TEST SUMMARY"
TOTAL=$((PASS + FAIL))
echo -e "  Total: $TOTAL  |  ${GREEN}Pass: $PASS${NC}  |  ${RED}Fail: $FAIL${NC}\n"
if (( FAIL == 0 )); then
  echo -e "  ${GREEN}ALL TESTS PASSED — Smart Grid API is fully operational.${NC}\n"
  exit 0
else
  echo -e "  ${RED}$FAIL test(s) FAILED. Review output above for details.${NC}\n"
  exit 1
fi
