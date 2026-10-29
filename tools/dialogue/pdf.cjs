const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
 await p.goto('file://' + process.argv[2]); await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
 footerTemplate: '<div style="font-size:7pt;width:100%;text-align:center;color:#888">Shadows of Almia Showdown · dialogue export · <span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' } });
 await b.close(); })();
