#!/bin/bash
# 매시간 파이프라인: 수집(collect) → 인기 랭킹(rank-popular). launchd가 매시 정각 호출.
# trend-collector의 run-sources.sh를 대체한다(수집+추출+저장이 한 폴더 안에서 완결).
set -uo pipefail

PROJECT_DIR="/Users/yang/TrendDrop"
NODE="/Users/yang/.nvm/versions/node/v22.12.0/bin/node"
PG_BIN="/opt/homebrew/opt/postgresql@14/bin"
LOG="$PROJECT_DIR/pipeline/.data/hourly.log"

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/pipeline/.data"

# .env.local(DATABASE_URL, YOUTUBE_API_KEY 등) 로드
set -a; . "$PROJECT_DIR/.env.local"; set +a

# 로컬 Postgres가 꺼져 있으면 시동(재부팅 후 등)
"$PG_BIN/pg_isready" -q || "$PG_BIN/pg_ctl" -D /opt/homebrew/var/postgresql@14 \
  -l /opt/homebrew/var/log/postgresql@14.log start

echo "==== $(date '+%Y-%m-%d %H:%M:%S') 시작 ====" >> "$LOG"
"$NODE" pipeline/collect.mjs             >> "$LOG" 2>&1
"$NODE" pipeline/rank-popular.mjs --save >> "$LOG" 2>&1
echo "" >> "$LOG"
