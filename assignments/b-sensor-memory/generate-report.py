from pathlib import Path

from PIL import Image, ImageOps
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUT_DIR = Path(__file__).resolve().parent
SCREENSHOT_PATH = OUT_DIR / "screenshot.png"
PDF_PATH = OUT_DIR / "final-report-draft.pdf"
SOURCE_SCREENSHOT = Path(
    r"C:\Users\rmky1\.codex\codex-remote-attachments\019fb5ef-270b-7261-a454-d849da741e51\E1E1EC22-5E11-4E98-A9EB-1E9E551C482E\1-写真1.jpg"
)


def make_screenshot() -> None:
    if SOURCE_SCREENSHOT.exists():
        img = Image.open(SOURCE_SCREENSHOT).convert("RGB")
        img.thumbnail((720, 1440), Image.Resampling.LANCZOS)
        img = ImageOps.grayscale(img).convert("RGB")
        img.save(SCREENSHOT_PATH)
    elif not SCREENSHOT_PATH.exists():
        Image.new("RGB", (590, 1280), "#202123").save(SCREENSHOT_PATH)


def make_pdf() -> None:
    pdfmetrics.registerFont(TTFont("ReportGothic", r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"))
    pdfmetrics.registerFont(TTFont("ReportMincho", r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc"))

    styles = {
        "title": ParagraphStyle("title", fontName="ReportGothic", fontSize=13, leading=17, spaceAfter=5, textColor=colors.black),
        "subtitle": ParagraphStyle("subtitle", fontName="ReportMincho", fontSize=10.5, leading=14, textColor=colors.black, spaceAfter=7),
        "h": ParagraphStyle("h", fontName="ReportGothic", fontSize=13, leading=17, spaceBefore=5, spaceAfter=3, textColor=colors.black),
        "body": ParagraphStyle("body", fontName="ReportMincho", fontSize=10.5, leading=14.5, wordWrap="CJK", textColor=colors.black),
        "small": ParagraphStyle("small", fontName="ReportMincho", fontSize=10.5, leading=14.5, wordWrap="CJK", textColor=colors.black),
        "warn": ParagraphStyle("warn", fontName="ReportMincho", fontSize=10.5, leading=14.5, wordWrap="CJK", textColor=colors.black),
    }

    def p(text, style="body"):
        return Paragraph(text.replace("\n", "<br/>"), styles[style])

    def styled_table(rows, widths):
        table = Table(rows, colWidths=widths)
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), "ReportMincho"),
                    ("FONTNAME", (0, 0), (0, -1), "ReportGothic"),
                    ("FONTSIZE", (0, 0), (0, -1), 10.5),
                    ("LEADING", (0, 0), (0, -1), 14.5),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        return table

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=13 * mm,
        leftMargin=13 * mm,
        topMargin=12 * mm,
        bottomMargin=10 * mm,
    )

    story = [
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題：スマートフォンセンサ Web アプリの制作（30点） / 制作内容", "subtitle"),
        styled_table(
            [
                [
                    "アプリ概要",
                    p("制作したアプリは「FE Learning OS」である。基本情報技術者試験の用語学習、知識マップ、問題演習、復習を行う学習アプリであり、その中にスマートフォンの端末方向センサを利用した「暗記モード」を実装している。暗記モードでは、知識マップ上の用語について「自分の言葉でまとめた記述」を隠し、端末を意図的に傾けたときだけ現在見ている用語の記述を一時表示する。"),
                ],
                [
                    "使用センサ",
                    p("使用したセンサはスマートフォンの端末方向センサである。ブラウザの DeviceOrientationEvent から beta（前後方向）と gamma（左右方向）を取得する。暗記モード開始時または「センサ再調整」を押した時点の姿勢を基準姿勢として扱い、現在値との差から傾き量を計算する。初期設定では、基準との差が25度以上の状態を約0.5秒保つと現在の用語だけ答えを表示し、10度以内に戻ると再び隠す。"),
                ],
                [
                    "公開URL",
                    p("公開アプリ: https://12rxxll.github.io/Fe/<br/>GitHub: https://github.com/12rxxll/Fe"),
                ],
            ],
            [34 * mm, 134 * mm],
        ),
        Spacer(1, 5),
        p("画面・動作", "h"),
    ]

    screenshot = RLImage(str(SCREENSHOT_PATH), width=45 * mm, height=98 * mm)
    story.append(
        Table(
            [
                [
                    screenshot,
                    p("マップ画面に「暗記モード」「センサ操作」「長押しで答えを見る」「すべて表示」「センサ再調整」を配置している。暗記モードをONにすると、用語カードの問いは表示したまま、自分の記述だけを隠す。センサ操作をONにすると、センサ状態パネルに「センサ」「基準との差」「状態」「表示まで」が表示される。端末を傾けると、基準との差と表示判定が変化する。手動操作として、長押し中だけ答えを見るボタンも用意している。<br/><br/>左図は既存アプリのマップ画面で暗記モードをONにした状態である。"),
                ]
            ],
            colWidths=[50 * mm, 118 * mm],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
        )
    )

    story += [
        Spacer(1, 3),
        p("デザインポリシー", "h"),
        p("スマートフォンで片手操作しやすいよう、暗記モードの操作はマップ画面上部にまとめた。センサ状態は色だけに頼らず、「ボタン操作のみ」「答えを隠しています」「あと25°」などの文字でも分かるようにしている。ダークモードでも読めるように、背景、文字、枠線のコントラストを確保した。"),
        p("動作確認", "h"),
        p("要追記：自分のスマートフォンで確認した端末名、OS、ブラウザ、分かった問題点を書く。記載例：iPhone / iOS 18.x / Safari またはホーム画面追加PWA。マップ画面で暗記モードをONにすると記述が隠れた。長押しで答えを表示できた。センサ操作は暗記モードON時だけ選択できた。センサ許可がない場合はボタン操作のみになる。HTTPS環境で開く必要がある。", "warn"),
        PageBreak(),
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題：AI利用記録", "subtitle"),
        styled_table(
            [
                ["使用した生成AI", p("ChatGPT / Codex")],
                ["モデル名", p("GPT-5 系のCodex")],
                ["チャット記録", p("要追記：提出時に、制作過程が確認できる主要なチャット共有リンクを貼る。", "warn")],
                ["AIへの指示", p("生成AIには、既存のFE Learning OSにスマートフォン内蔵センサを使った暗記モードを追加し、端末を傾けたときだけ現在の用語の記述を表示するよう指示した。また、外部通信、アクセス解析、カメラ、マイク、位置情報を使わず、センサ値を保存・送信しないように指定した。")],
                ["確認・修正", p("AIが作成したコードに対して、提出要件に合うように次の点を確認・修正した。DeviceOrientationEvent.requestPermission() をユーザー操作内で呼び、iPhone Safariの許可処理に対応した。暗記モードOFF時はセンサ操作を無効化し、ON時だけ使えるようにした。センサ値は画面表示と判定だけに使い、保存しない構成にした。センサが拒否・非対応の場合でも、長押しで答えを見る手動操作を使えるようにした。状態を色だけでなく、文字ラベルでも確認できるようにした。")],
                ["提出方法", p("公開アプリURLまたはGitHub URLを提出する。公開アプリ: https://12rxxll.github.io/Fe/ / GitHub: https://github.com/12rxxll/Fe")],
                ["安全性", p("外部API、外部CDN、アクセス解析、カメラ、マイク、位置情報は暗記モードで使用していない。beta/gammaなどのセンサ値は画面表示と判定にだけ使い、ブラウザ内やサーバには保存しない。")],
            ],
            [43 * mm, 125 * mm],
        ),
        Spacer(1, 7),
        p("提出前チェック", "h"),
        p("1. 公開URL https://12rxxll.github.io/Fe/ をスマートフォンで開く。 2. マップ画面で暗記モードをONにし、長押し表示とセンサ操作を確認する。 3. 動作確認欄とチャット共有リンクを自分の内容に差し替える。", "small"),
    ]

    doc.build(story)


if __name__ == "__main__":
    make_screenshot()
    make_pdf()
    print(f"{PDF_PATH} pages={len(PdfReader(str(PDF_PATH)).pages)}")
