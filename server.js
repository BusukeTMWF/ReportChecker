const express = require('express');
const multer = require('multer');
const PDFParser = require('pdf2json');
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

    const pdfParser = new PDFParser();

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

        // 修正箇所を表示するための配列
        const unitErrors = [];

        // --- 1. 句読点チェック（特定表示版） ---
        const puncRegex = /[。、]/g;
        let matchPunc;
        let puncCount = 0;

        while ((matchPunc = puncRegex.exec(text)) !== null) {
            puncCount++;
            const start = Math.max(0, matchPunc.index - 15);
            const end = Math.min(text.length, matchPunc.index + matchPunc[0].length + 15);
            const context = "..." + text.substring(start, end).replace(/\n/g, " ") + "...";

            unitErrors.push({
                type: '句読点混入',
                found: matchPunc[0],
                context: context,
                advice: `理系レポートでは「${matchPunc[0]}」ではなく、原則としてカンマ「，」およびピリオド「．」を使用します。`
            });
        }

        const puncResult = puncCount > 0 
            ? { status: 'error', message: `❌ 「。 」または「、」が計 ${puncCount} 箇所見つかりました。下の「要修正・確認箇所の一覧」を確認してください。` }
            : { status: 'success', message: '✅ 句読点の統一は完璧です！（「。、」の混入なし）' };

        // --- 2. 図番号の連番チェック ---
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

        // --- 3. 表番号の連番チェック ---
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

        // --- 4. ページ番号の書式チェック ---
        const pageRegex = /p\.\s*\d+\s*\/\s*\d+/gi;
        const pageResult = pageRegex.test(text)
            ? { status: 'success', message: '✅ ページ番号（p.X/Y）の指定書式が確認できました。' }
            : { status: 'error', message: '❌ 「p.現在のページ/総ページ数」形式のページ番号が見つかりません。レポート用紙の下部に記載してください。' };

        // --- 5. 単位チェック（大文字小文字のミス） ---
        const unitMistakeRegex = /(\d+)\s*(Kg|秒|分|時間)/g;
        let matchUnit;
        while ((matchUnit = unitMistakeRegex.exec(text)) !== null) {
            const start = Math.max(0, matchUnit.index - 15);
            const end = Math.min(text.length, matchUnit.index + matchUnit[0].length + 15);
            const context = "..." + text.substring(start, end).replace(/\n/g, " ") + "...";
            
            let advice = "";
            if (matchUnit[2] === 'Kg') advice = "キログラムは小文字の「kg」です。大文字のKは絶対温度（ケルビン）になります。";
            if (matchUnit[2] === '秒') advice = "時間は国際単位系（SI単位）の「s」で表記してください。";
            if (matchUnit[2] === '分') advice = "時間は「min」で表記してください。";
            if (matchUnit[2] === '時間') advice = "時間は「h」で表記してください。";

            unitErrors.push({
                type: '表記ミス',
                found: matchUnit[0],
                context: context,
                advice: advice
            });
        }

        // --- 6. 数字と単位の間のスペース漏れ ---
        const spaceMissingRegex = /(\d+)(mm|cm|m|kg|Hz|Pa|V|A|℃)/g;
        let matchSpace;
        while ((matchSpace = spaceMissingRegex.exec(text)) !== null) {
            const start = Math.max(0, matchSpace.index - 15);
            const end = Math.min(text.length, matchSpace.index + matchSpace[0].length + 15);
            const context = "..." + text.substring(start, end).replace(/\n/g, " ") + "...";

            unitErrors.push({
                type: 'スペース漏れ',
                found: matchSpace[0],
                context: context,
                advice: `数字「${matchSpace[1]}」と単位「${matchSpace[2]}」の間に半角スペースが必要です。（例: ${matchSpace[1]} ${matchSpace[2]}）`
            });
        }

        // --- 7. 主観表現チェック ---
        const thinkRegex = /(だと思う|思われる|感じた)/g;
        let matchThink;
        while ((matchThink = thinkRegex.exec(text)) !== null) {
            const start = Math.max(0, matchThink.index - 15);
            const end = Math.min(text.length, matchThink.index + matchThink[0].length + 15);
            const context = "..." + text.substring(start, end).replace(/\n/g, " ") + "...";

            unitErrors.push({
                type: '主観表現',
                found: matchThink[0],
                context: context,
                advice: "実験レポートでは主観的な表現は避けてください。「〜と考えられる」「〜と推測される」などに書き換えてください。"
            });
        }

        // 全ての結果をレスポンス
        res.json({ puncResult, figResult, tableResult, pageResult, unitErrors });
    });

    // 💡 重要：ここが正しい位置にある必要があります
    pdfParser.parseBuffer(req.file.buffer);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});