#!/bin/bash
# SessionStart フック ─ 開いた瞬間に最新を取り込み、「何が起きたか」を Claude に伝える
#
# なぜ必要か:
#   このページは複数のPCやブラウザ版から直す。
#   別の場所で直して push したあと、古い手元のまま作業を始めると
#   「古い手元」と「進んだGitHub」がぶつかる。
#
# この仕組みが保証すること:
#   ★git は、他の場所で push された変更を勝手に消さない。
#     ぶつかったときは「止まる」だけ。だからデータは失われない。
#   ★ただし「止まった」ことに Claude が気づかないと意味がないので、
#     このスクリプトが状況を言葉にして渡す。
#
# ★このリポジトリは public。push は本人のOKをもらってから（CLAUDE.md 参照）。
#   だから「終わる前に自動で push させる」Stop フックは置いていない。
set -u

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0
cat >/dev/null 2>&1   # stdin の JSON は使わないので捨てる

before=$(git rev-parse HEAD 2>/dev/null || echo none)
dirty_before=$(git status --porcelain 2>/dev/null)

out=$(git pull --rebase --autostash origin main 2>&1)
rc=$?

if [ "$rc" != "0" ]; then
  echo "★最新の取り込みに失敗した（衝突、またはネットワーク）。"
  echo "★本人は git を自分では打たない。あなた（Claude）が対処すること:"
  echo "  1. git status と git stash list を見て、いま何が起きているか把握する"
  echo "  2. 衝突なら中身を読んで解決し、git rebase --continue で進める"
  echo "  3. 判断がつかなければ、勝手に捨てずに本人へ状況を報告して指示を仰ぐ"
  echo "  ★どんな場合でも、他の場所で push された変更を消さないこと。"
  echo "  ★退避した変更は git stash に残っている。消える前提で動かないこと。"
  echo "--- git の出力 ---"
  echo "$out"
  exit 0
fi

after=$(git rev-parse HEAD 2>/dev/null || echo none)

if [ "$before" != "$after" ] && [ "$before" != "none" ]; then
  echo "★他の場所で進んでいた分を取り込んだ:"
  git log --oneline "$before..$after" 2>/dev/null | head -20
  echo "★作業に入る前に、../frenvox-brain 側も最新か確かめること。"
fi

if [ -n "$dirty_before" ]; then
  echo "★セッション開始時に未コミットの変更が残っていた（＝前回、押さずに終わっている）。"
  echo "  いったん退避して pull し、そのあと戻してある。git status で中身を確認し、"
  echo "  今回の作業と混ざらないようにすること。★push は本人に見せてOKをもらってから。"
fi

exit 0
