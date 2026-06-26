#!/bin/bash
# READER MAP ローカルサーバ起動
# usage: ./serve.sh [port]
PORT=${1:-8080}
cd "$(dirname "$0")"
echo "READER MAP: http://localhost:${PORT}/relation_graph.html"
echo "hasyamo:    http://localhost:${PORT}/relation_graph.html?user=hasyamo"
python3 -m http.server $PORT
