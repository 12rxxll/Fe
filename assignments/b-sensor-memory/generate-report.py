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
    font_regular = r"C:\Windows\Fonts\meiryo.ttc"
    font_bold = r"C:\Windows\Fonts\meiryob.ttc"
    big = ImageFont.truetype(font_regular, 30)
    mid = ImageFont.truetype(font_bold, 20)
    small = ImageFont.truetype(font_regular, 15)
    tiny = ImageFont.truetype(font_regular, 12)

    img = Image.new("RGB", (390, 844), "#202123")
    draw = ImageDraw.Draw(img)

    def rr(box, radius, fill, outline=None, width=1):
        draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

    def text(pos, value, font, fill="#f4f4f4", anchor=None):
        draw.text(pos, value, font=font, fill=fill, anchor=anchor)

    text((22, 28), "Sensor Web App", tiny, "#10a37f")
    text((22, 54), "FEL Tilt Memory Cards", big)
    text((22, 102), "スマホを傾けると答えが出るFE暗記カード", small, "#c5c5d2")

    rr((18, 140, 372, 322), 22, "#2a2b2f", "#45464f", 2)
    text((38, 162), "端末方向センサ", mid)
    rr((250, 158, 340, 194), 18, "#103f35")
    text((295, 176), "センサON", tiny, "#65e5c8", "mm")
    labels = [("beta 前後", "12°"), ("gamma 左右", "-8°"), ("基準との差", "27°"), ("判定", "表示")]
    for i, (label, value) in enumerate(labels):
        x = 38 + (i % 2) * 160
        y = 210 + (i // 2) * 52
        rr((x, y, x + 140, y + 42), 14, "#343541", "#45464f")
        text((x + 10, y + 6), label, tiny, "#c5c5d2")
        text((x + 10, y + 20), value, small)
    rr((38, 284, 332, 300), 8, "#343541")
    rr((38, 284, 275, 300), 8, "#10a37f")
    draw.rectangle((282, 281, 285, 303), fill="#d58b3a")

    rr((18, 344, 372, 638), 24, "#2a2b2f", "#45464f", 2)
    rr((38, 366, 104, 398), 16, "#343541")
    text((71, 382), "1 / 6", tiny, "#c5c5d2", "mm")
    rr((248, 366, 340, 398), 16, "#103f35")
    text((294, 382), "答え表示中", tiny, "#65e5c8", "mm")
    text((195, 438), "2進数", big, "#65e5c8", "mm")
    rr((38, 466, 352, 536), 18, "#343541")
    text((54, 484), "「2進数」とは何ですか。", small)
    text((54, 512), "FEで問われるポイントを思い出してください。", tiny, "#c5c5d2")
    rr((38, 554, 352, 614), 18, "#f4f4f4")
    text((54, 570), "0と1だけで数を表す記数法。", tiny, "#202123")
    text((54, 594), "基数変換やビット演算の前提。", tiny, "#202123")

    rr((18, 660, 372, 742), 22, "#2a2b2f", "#45464f", 2)
    text((38, 684), "自己確認", mid)
    for i, label in enumerate(["覚えていた", "あいまい", "まだ"]):
        x = 38 + i * 105
        rr((x, 712, x + 90, 752), 20, "#343541", "#45464f")
        text((x + 45, 732), label, tiny, "#f4f4f4", "mm")

    img.save(SCREENSHOT_PATH)


def make_pdf() -> None:
    pdfmetrics.registerFont(TTFont("Meiryo", r"C:\Windows\Fonts\meiryo.ttc"))
    pdfmetrics.registerFont(TTFont("MeiryoBold", r"C:\Windows\Fonts\meiryob.ttc"))
    styles = {
        "title": ParagraphStyle("title", fontName="MeiryoBold", fontSize=16, leading=20, spaceAfter=6),
        "subtitle": ParagraphStyle(
            "subtitle",
            fontName="Meiryo",
            fontSize=9.5,
            leading=13,
            textColor=colors.HexColor("#4b5563"),
            spaceAfter=8,
        ),
        "h": ParagraphStyle("h", fontName="MeiryoBold", fontSize=11.2, leading=14, spaceBefore=5, spaceAfter=3),
        "body": ParagraphStyle("body", fontName="Meiryo", fontSize=8.9, leading=12.1, wordWrap="CJK"),
        "small": ParagraphStyle(
            "small",
            fontName="Meiryo",
            fontSize=8,
            leading=10.5,
            wordWrap="CJK",
            textColor=colors.HexColor("#374151"),
        ),
        "warn": ParagraphStyle(
            "warn",
            fontName="MeiryoBold",
            fontSize=8.6,
            leading=11.2,
            wordWrap="CJK",
            textColor=colors.HexColor("#b45309"),
        ),
    }

    def p(text, style="body"):
        return Paragraph(text.replace("\n", "<br/>"), styles[style])

    def style_table(table):
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
    ]
    story.append(
        style_table(
            Table(
                [
                    [
                        "アプリ概要",
                        p(
                            "制作したアプリは「FEL Tilt Memory Cards」である。基本情報技術者試験の用語カードを表示し、スマートフォンを基準姿勢から大きく傾けたときだけ答えを表示する。暗記中に答えを常時見せず、意図的な端末操作で確認することを目的にした。主な機能は、FE用語カード、センサ値表示、傾き量のゲージ可視化、しきい値判定による答え表示、長押しによる手動代替操作、自己確認である。"
                        ),
                    ],
                    [
                        "使用センサ",
                        p(
                            "スマートフォンの端末方向センサを使用した。ブラウザの DeviceOrientationEvent から beta（前後方向）と gamma（左右方向）を取得し、基準姿勢との差分から傾き量を計算する。25度以上の傾きを約0.5秒保つと現在カードの答えを表示し、10度以内へ戻すと再び隠す。小さな揺れで点滅しないよう、移動平均と表示/非表示で異なるしきい値を使った。"
                        ),
                    ],
                ],
                colWidths=[27 * mm, 141 * mm],
            )
        )
    )
    story += [Spacer(1, 5), p("画面・動作", "h")]
    screenshot = RLImage(str(SCREENSHOT_PATH), width=58 * mm, height=126 * mm)
    story.append(
        Table(
            [
                [
                    screenshot,
                    p(
                        "画面上部にはセンサ開始と基準姿勢登録のボタンを置き、その下に beta、gamma、基準との差、現在の判定を表示する。ゲージでは表示しきい値までの傾き量を可視化する。中央の用語カードは通常は答えが隠れ、スマートフォンを傾けるか「長押しで見る」を押している間だけ答えが見える。前後ボタンでカードを移動すると、次のカードは再び答えが隠れた状態から始まる。<br/><br/>※左図は提出用 index.html の画面構成を示すスクリーンショット見本。提出前に自分のスマートフォンで撮影した画像へ差し替えるとよい。"
                    ),
                ]
            ],
            colWidths=[63 * mm, 105 * mm],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
        )
    )
    story += [
        Spacer(1, 3),
        p("デザインポリシー", "h"),
        p("スマートフォンで片手操作しやすいよう、主要ボタンは44px以上のタップ領域を確保した。配色は明るい背景、白いカード、緑系アクセントで構成し、ダークモードにも対応した。センサ状態は色だけに頼らず、「未開始」「センサON」「答え表示中」などの文字ラベルでも分かるようにした。"),
        p("動作確認", "h"),
        p("要追記：自分のスマートフォンで確認した端末名、OS、ブラウザ、分かった問題点を書く。記載例：iPhone 15 / iOS 18.x / Safari。センサ開始時に許可ダイアログが出て、25度程度傾けると答えが表示され、戻すと隠れた。HTTPSでない環境ではセンサが動かない場合があるため、手動の長押し表示も用意した。", "warn"),
        PageBreak(),
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題：AI利用記録", "subtitle"),
    ]
    story.append(
        style_table(
            Table(
                [
                    ["使用した生成AI", p("ChatGPT / Codex")],
                    ["モデル名", p("GPT-5 系のCodex")],
                    ["チャット記録", p("要追記：提出時に、制作過程が確認できる主要なチャット共有リンクを貼る。", "warn")],
                    [
                        "AIへの指示",
                        p(
                            "生成AIには、スマートフォン内蔵センサを1種類以上使い、センサ値の表示だけでなく可視化・判定・操作を含むWebアプリを index.html 1ファイルで作るよう指示した。また、外部通信、アクセス解析、カメラ、マイク、位置情報を使わず、センサ値を保存・送信しないように指定した。"
                        ),
                    ],
                    [
                        "確認・修正",
                        p(
                            "AIが作成したコードに対して、提出要件に合うように次の点を確認・修正した。CSSとJavaScriptをすべて index.html 内へ入れ、1ファイルで完結させた。iPhone Safari向けに DeviceOrientationEvent.requestPermission() をユーザー操作内で呼ぶようにした。センサが拒否・非対応の場合でも使えるよう長押しで答えを見る手動代替機能を入れた。センサ値、基準角度、履歴を保存せず、外部通信も行わない構成にした。画面表示では色だけに頼らず、状態ラベルも併記した。"
                        ),
                    ],
                    ["提出ファイル", p("制作ファイルは assignments/b-sensor-memory/index.html。CSSとJavaScriptを同じファイル内に含めている。提出時はこの index.html を単体で提出する。")],
                    ["安全性", p("外部通信、アクセス解析、外部CDNは使用していない。カメラ、マイク、位置情報も使用していない。beta/gammaなどのセンサ値は画面表示と判定にだけ使い、localStorageやサーバには保存しない。")],
                ],
                colWidths=[30 * mm, 138 * mm],
            )
        )
    )
    story += [
        Spacer(1, 7),
        p("提出前チェック", "h"),
        p("1. 自分のスマートフォンで index.html を開き、センサ開始、基準姿勢登録、傾けたときの答え表示、戻したときの非表示を確認する。 2. 実機のスクリーンショットを撮り、必要ならこのPDFの画面見本と差し替える。 3. 動作確認欄とチャット共有リンクを自分の内容に差し替える。", "small"),
    ]
    doc.build(story)


if __name__ == "__main__":
    make_screenshot()
    make_pdf()
    page_count = len(PdfReader(str(PDF_PATH)).pages)
    print(f"{PDF_PATH} pages={page_count}")
