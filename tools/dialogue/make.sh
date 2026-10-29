#!/usr/bin/env bash
# Regenerates docs/dialogue/: the Markdown and JSON export, then the PDF (needs python3-markdown and Playwright).
set -e
cd "$(dirname "$0")/../.."
npx tsx tools/dialogue/export.ts docs/dialogue
python3 tools/dialogue/to_html.py docs/dialogue/dialogue-export.md docs/dialogue/.dialogue.html
node tools/dialogue/pdf.cjs "$PWD/docs/dialogue/.dialogue.html" docs/dialogue/dialogue-export.pdf
rm -f docs/dialogue/.dialogue.html
