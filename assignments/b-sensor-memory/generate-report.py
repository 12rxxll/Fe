from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
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


def make_screenshot() -> None:
    regular = r"C:\Windows\Fonts\meiryo.ttc"
    bold = r"C:\Windows\Fonts\meiryob.ttc"
    font_title = ImageFont.truetype(regular, 38)
    font_h = ImageFont.truetype(bold, 22)
    font_body = ImageFont.truetype(regular, 16)
    font_small = ImageFont.truetype(regular, 13)

    img = Image.new("RGB", (390, 844), "#202123")
    draw = ImageDraw.Draw(img)

    def rr(box, radius, fill, outline=None, width=1):
        draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

    def text(pos, value, font, fill="#f4f4f4", anchor=None):
        draw.text(pos, value, font=font, fill=fill, anchor=anchor)

    text((22, 28), "Sensor Web App", font_small, "#10a37f")
    text((22, 58), "Tilt Check", font_title)
    text((22, 112), "スマートフォンの傾きを見える化します", font_body, "#c5c5d2")

    rr((18, 150, 372, 274), 22, "#2a2b2f", "#474852", 2)
    text((38, 172), "センサ操作", font_h)
    rr((38, 210, 178, 254), 14, "#10a37f")
    text((108, 232), "センサを開始", font_small, "#ffffff", "mm")
    rr((194, 210, 334, 254), 14, "#343541", "#474852")
    text((264, 232), "基準にする", font_small, "#f4f4f4", "mm")

    rr((18, 298, 372, 658), 24, "#2a2b2f", "#474852", 2)
    text((38, 322), "傾きメーター", font_h)
    rr((270, 316, 340, 350), 17, "#103f35")
    text((305, 333), "安定", font_small, "#65e5c8", "mm")

    rr((73, 374, 317, 618), 28, "#343541", "#474852")
    draw.line((195, 402, 195, 590), fill="#5c5d68", width=1)
    draw.line((101, 496, 289, 496), fill="#5c5d68", width=1)
    draw.ellipse((153, 454, 237, 538), outline="#10a37f", width=3)
    draw.ellipse((176, 477, 218, 519), fill="#10a37f")

    text((195, 678), "安定しています", font_h, "#65e5c8", "mm")
    rr((38, 704, 352, 720), 8, "#343541")
    rr((38, 704, 136, 720), 8, "#10a37f")
    draw.rectangle((248, 701, 251, 723), fill="#c46a1c")

    labels = [("beta 前後", "3°"), ("gamma 左右", "-4°"), ("基準との差", "6°")]
    for i, (label, value) in enumerate(labels):
        x = 38 + i * 104
        rr((x, 740, x + 92, 796), 14, "#343541", "#474852")
        text((x + 10, 750), label, font_small, "#c5c5d2")
        text((x + 10, 772), value, font_body)

    img.save(SCREENSHOT_PATH)


def make_pdf() -> None:
    pdfmetrics.registerFont(TTFont("Meiryo", r"C:\Windows\Fonts\meiryo.ttc"))
    pdfmetrics.registerFont(TTFont("MeiryoBold", r"C:\Windows\Fonts\meiryob.ttc"))

    styles = {
        "title": ParagraphStyle("title", fontName="MeiryoBold", fontSize=16, leading=20, spaceAfter=6),
        "subtitle": ParagraphStyle("subtitle", fontName="Meiryo", fontSize=9.5, leading=13, textColor=colors.HexColor("#4b5563"), spaceAfter=8),
        "h": ParagraphStyle("h", fontName="MeiryoBold", fontSize=11.2, leading=14, spaceBefore=5, spaceAfter=3),
        "body": ParagraphStyle("body", fontName="Meiryo", fontSize=8.9, leading=12.1, wordWrap="CJK"),
        "small": ParagraphStyle("small", fontName="Meiryo", fontSize=8, leading=10.5, wordWrap="CJK", textColor=colors.HexColor("#374151")),
        "warn": ParagraphStyle("warn", fontName="MeiryoBold", fontSize=8.6, leading=11.2, wordWrap="CJK", textColor=colors.HexColor("#b45309")),
    }

    def p(text, style="body"):
        return Paragraph(text.replace("\n", "<br/>"), styles[style])

    def styled_table(rows, widths):
        table = Table(rows, colWidths=widths)
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), "Meiryo"),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f0")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
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
                    p("制作したアプリは「Tilt Check」である。スマートフォンの端末方向センサを使って、現在の持ち方が基準姿勢からどれくらい傾いたかを測定し、画面上のメーターと判定文で表示する。主な機能は、センサ開始、基準姿勢の登録、beta/gammaの数値表示、傾き量のゲージ表示、中央の点による可視化、傾きの3段階判定である。"),
                ],
                [
                    "使用センサ",
                    p("スマートフォンの端末方向センサを使用した。ブラウザの DeviceOrientationEvent から beta（前後方向）と gamma（左右方向）を取得する。「基準にする」ボタンを押した時点の beta/gamma を基準姿勢とし、現在値との差から傾き量を計算する。基準との差が10度未満なら「安定」、10度以上20度未満なら「少し傾き」、20度以上なら「大きく傾き」と判定する。"),
                ],
            ],
            [27 * mm, 141 * mm],
        ),
        Spacer(1, 5),
        p("画面・動作", "h"),
    ]

    screenshot = RLImage(str(SCREENSHOT_PATH), width=58 * mm, height=126 * mm)
    story.append(
        Table(
            [[screenshot, p("画面上部には「センサを開始」と「基準にする」の2つのボタンを配置した。センサを開始した後、自然な持ち方で「基準にする」を押すと、その姿勢が基準になる。中央の傾きメーターでは、端末の傾きに合わせて点が移動する。下部には beta、gamma、基準との差を表示し、ゲージで傾き量を可視化する。判定結果は「安定」「少し傾き」「大きく傾き」の3段階で表示する。<br/><br/>※左図は提出用 index.html の画面構成を示すスクリーンショット見本。提出前に自分のスマートフォンで撮影した画像へ差し替えるとよい。")]],
            colWidths=[63 * mm, 105 * mm],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
        )
    )

    story += [
        Spacer(1, 3),
        p("デザインポリシー", "h"),
        p("スマートフォンで見やすく、説明書なしでも操作しやすい画面を目指した。操作は「センサを開始」「基準にする」の2つに絞り、判定結果は大きな文字で表示した。状態は色だけに頼らず、「安定」「注意」「大きく傾き」などのラベルでも分かるようにした。"),
        p("動作確認", "h"),
        p("要追記：自分のスマートフォンで確認した端末名、OS、ブラウザ、分かった問題点を書く。記載例：iPhone 15 / iOS 18.x / Safari。センサ開始時に許可ダイアログが出た。基準姿勢を登録したあと、端末を傾けると点が動き、判定が変化した。HTTPSでない環境では端末によってセンサが動かない場合がある。", "warn"),
        PageBreak(),
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題：AI利用記録", "subtitle"),
        styled_table(
            [
                ["使用した生成AI", p("ChatGPT / Codex")],
                ["モデル名", p("GPT-5 系のCodex")],
                ["チャット記録", p("要追記：提出時に、制作過程が確認できる主要なチャット共有リンクを貼る。", "warn")],
                ["AIへの指示", p("生成AIには、スマートフォン内蔵センサを1種類以上使い、センサ値の表示だけでなく可視化と判定を含むWebアプリを index.html 1ファイルで作るよう指示した。また、既存のFE学習アプリ本体を変更せず、課題提出用ファイルだけを作成するように指定した。")],
                ["確認・修正", p("AIが作成したコードに対して、提出要件に合うように次の点を確認・修正した。CSSとJavaScriptをすべて index.html 内へ入れ、1ファイルで完結させた。iPhone Safari向けに DeviceOrientationEvent.requestPermission() をユーザー操作内で呼ぶようにした。画面要素を整理し、ボタン、メーター、判定、数値表示だけのシンプルな構成にした。センサ値、基準角度、履歴を保存せず、外部通信も行わない構成にした。画面表示では色だけに頼らず、状態ラベルも併記した。")],
                ["提出ファイル", p("制作ファイルは assignments/b-sensor-memory/index.html。CSSとJavaScriptを同じファイル内に含めている。提出時はこの index.html を単体で提出する。FE Learning OS 本体の index.html や assets は変更していない。")],
                ["安全性", p("外部通信、アクセス解析、外部CDNは使用していない。カメラ、マイク、位置情報も使用していない。beta/gammaなどのセンサ値は画面表示と判定にだけ使い、ブラウザ内やサーバには保存しない。")],
            ],
            [30 * mm, 138 * mm],
        ),
        Spacer(1, 7),
        p("提出前チェック", "h"),
        p("1. 自分のスマートフォンで index.html を開き、センサ開始、基準姿勢登録、傾けたときの点の移動と判定変化を確認する。 2. 実機のスクリーンショットを撮り、必要ならこのPDFの画面見本と差し替える。 3. 動作確認欄とチャット共有リンクを自分の内容に差し替える。", "small"),
    ]

    doc.build(story)


if __name__ == "__main__":
    make_screenshot()
    make_pdf()
    print(f"{PDF_PATH} pages={len(PdfReader(str(PDF_PATH)).pages)}")
