const express = require('express');
const multer = require('multer');
const PDFParser = require('pdf2json'); // 世界的な超定番ライブラリ
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/check', upload.single('report'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'ファイルがアップロードされていません。' });
    }

    // PDFパーサーのインスタンスを作成
    const pdfParser = new PDFParser();

    // 解析失敗時のイベント
    pdfParser.on("pdfParser_dataError", errData => {
        console.error("PDF解析エラー:", errData.parserError);
        res.status(500).json({ error: 'PDFの解析に失敗しました。' });
    });

    pdfParser.on("pdfParser_dataReady", pdfData => {
        const safeDecode = (str) => {
            try { return decodeURIComponent(str); } 
            catch (e) { return unescape(str); }
        };

        let text = "";
        for (let page of pdfData.Pages) {
            for (let textObj of page.Texts) {
                for (let t of textObj.R) {
                    text += safeDecode(t.T);
                }
            }
        }

        // --- 1. 句読点チェック ---
        const invalidPunctuation = (text.match(/[。、]/g) || []);
        const puncResult = invalidPunctuation.length > 0 
            ? { status: 'error', message: `❌ 「。 」または「、」が計 ${invalidPunctuation.length} 箇所見つかりました。理系レポートでは「．」「，」への統一が推奨されます。` }
            : { status: 'success', message: '✅ 句読点の統一は完璧です！（「。、」の混入なし）' };

        // --- 2. 図番号の連番チェック（項目8対応） ---
        const figRegex = /図\s*(\d+)/g;
        let matchFig;
        const figNumbers = [];
        while ((matchFig = figRegex.exec(text)) !== null) {
            figNumbers.push(parseInt(matchFig[1], 10));
        }

        let figResult = { status: 'info', message: 'ℹ️ 本文中に「図X」という表記は見つかりませんでした。' };
        if (figNumbers.length > 0) {
            const uniqueFigs = [...new Set(figNumbers)].sort((a, b) => a - b);
            const maxFig = Math.max(...uniqueFigs);
            const missingFigs = Array.from({length: maxFig}, (_, i) => i + 1).filter(n => !uniqueFigs.includes(n));

            if (missingFigs.length > 0) {
                figResult = { status: 'error', message: `❌ 図番号に欠番があります: 図 ${missingFigs.join(', ')}。※図番号とタイトルは「図の下部」に記載してください。` };
            } else {
                figResult = { status: 'success', message: `✅ 図番号は 1 から 図 ${maxFig} まで正しく並んでいます。` };
            }
        }

        // --- 3. 表番号の連番チェック（項目4対応） ---
        const tableRegex = /表\s*(\d+)/g;
        let matchTable;
        const tableNumbers = [];
        while ((matchTable = tableRegex.exec(text)) !== null) {
            tableNumbers.push(parseInt(matchTable[1], 10));
        }

        let tableResult = { status: 'info', message: 'ℹ️ 本文中に「表X」という表記は見つかりませんでした。' };
        if (tableNumbers.length > 0) {
            const uniqueTables = [...new Set(tableNumbers)].sort((a, b) => a - b);
            const maxTable = Math.max(...uniqueTables);
            const missingTables = Array.from({length: maxTable}, (_, i) => i + 1).filter(n => !uniqueTables.includes(n));

            if (missingTables.length > 0) {
                tableResult = { status: 'error', message: `❌ 表番号に欠番があります: 表 ${missingTables.join(', ')}。※表番号とタイトルは「表の上部」に記載してください。` };
            } else {
                tableResult = { status: 'success', message: `✅ 表番号は 1 から 表 ${maxTable} まで正しく並んでいます。` };
            }
        }

        // --- 4. ページ番号の書式チェック（項目32対応） ---
        // 「p.数字/数字」または「p. 数字 / 数字」のフォーマットを探す
        const pageRegex = /p\.\s*\d+\s*\/\s*\d+/gi;
        const hasPageNumber = pageRegex.test(text);
        const pageResult = hasPageNumber
            ? { status: 'success', message: '✅ ページ番号（p.X/Y）の指定書式が確認できました。' }
            : { status: 'error', message: '❌ 「p.現在のページ/総ページ数」形式のページ番号が見つかりません。レポート用紙の下部に記載してください。' };


        // 判定結果をブラウザに返す
        res.json({ puncResult, figResult, tableResult, pageResult });
    });
    
    // メモリ上のバッファ（PDFデータ）を読み込ませて解析をスタート
    pdfParser.parseBuffer(req.file.buffer);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});