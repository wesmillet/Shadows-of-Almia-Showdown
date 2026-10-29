"""Turns the dialogue export Markdown into print-ready HTML for tools/dialogue/pdf.cjs."""
import sys, markdown
CSS = open(__file__.replace('to_html.py', 'print.css')).read()
html = markdown.markdown(open(sys.argv[1]).read(), extensions=['tables', 'toc', 'sane_lists'])
open(sys.argv[2], 'w').write('<!doctype html><html><head><meta charset="utf-8"><title>Dialogue export</title><style>' + CSS + '</style></head><body>' + html + '</body></html>')
