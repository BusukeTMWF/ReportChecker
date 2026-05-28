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

    // 解析成功時のイベント
    pdfParser.on("pdfParser_dataReady", pdfData => {
        // pdf2jsonはテキストがURLエンコードされた形でパースされるため、デコードして1つの文字列に結合
        // 安全にURIデコードを行うための関数
        const safeDecode = (str) => {
            try {
                return decodeURIComponent(str);
            } catch (e) {
                // デコードに失敗した特殊文字（%など）は、そのままか、エスケープして救う
                return unescape(str); 
            }
        };

        let text = "";
        for (let page of pdfData.Pages) {
            for (let textObj of page.Texts) {
                for (let t of textObj.R) {
                    text += safeDecode(t.T); // 安全な関数に差し替え
                }
            }
        }

        // --- 1. 句読点チェック ---
        const invalidPunctuation = (text.match(/[。、]/g) || []);
        const puncResult = invalidPunctuation.length > 0 
            ? { status: 'error', message: `❌ 「。 」または「、」が計 ${invalidPunctuation.length} 箇所見つかりました。理系レポートでは「．」「，」への統一が推奨されます。` }
            : { status: 'success', message: '✅ 句読点の統一は完璧です！（「。、」の混入なし）' };

        // --- 2. 図番号の連番チェック ---
        const figRegex = /図\s*(\d+)/g;
        let match;
        const figNumbers = [];
        while ((match = figRegex.exec(text)) !== null) {
            figNumbers.push(parseInt(match[1], 10));
        }

        let figResult = { status: 'info', message: 'ℹ️ 本文中に「図X」という表記は見つかりませんでした。' };
        
        if (figNumbers.length > 0) {
            const uniqueFigs = [...new Set(figNumbers)].sort((a, b) => a - b);
            const maxFig = Math.max(...uniqueFigs);
            const missingFigs = [];
            
            for (let i = 1; i <= maxFig; i++) {
                if (!uniqueFigs.includes(i)) {
                    missingFigs.push(i);
                }
            }

            if (missingFigs.length > 0) {
                figResult = { status: 'error', message: `❌ 図番号に欠番があります。確認してください: 図 ${missingFigs.join(', ')}` };
            } else {
                figResult = { status: 'success', message: `✅ 図番号は 1 から 図 ${maxFig} まで正しく並んでいます。` };
            }
        }

        // 判定結果をブラウザに返す
        res.json({ puncResult, figResult });
    });

    // メモリ上のバッファ（PDFデータ）を読み込ませて解析をスタート
    pdfParser.parseBuffer(req.file.buffer);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});