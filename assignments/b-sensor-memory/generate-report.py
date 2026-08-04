# -*- coding: utf-8 -*-
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
        Image.new("RGB", (590, 1280), "#ffffff").save(SCREENSHOT_PATH)


def make_pdf() -> None:
    pdfmetrics.registerFont(TTFont("ReportGothic", r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"))
    pdfmetrics.registerFont(TTFont("ReportMincho", r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc"))

    styles = {
        "title": ParagraphStyle(
            "title",
            fontName="ReportGothic",
            fontSize=13,
            leading=17,
            spaceAfter=4,
            textColor=colors.black,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            fontName="ReportMincho",
            fontSize=10.5,
            leading=14,
            textColor=colors.black,
            spaceAfter=6,
        ),
        "h": ParagraphStyle(
            "h",
            fontName="ReportGothic",
            fontSize=13,
            leading=17,
            spaceBefore=3,
            spaceAfter=3,
            textColor=colors.black,
        ),
        "body": ParagraphStyle(
            "body",
            fontName="ReportMincho",
            fontSize=10.5,
            leading=14.1,
            wordWrap="CJK",
            textColor=colors.black,
        ),
        "small": ParagraphStyle(
            "small",
            fontName="ReportMincho",
            fontSize=10.5,
            leading=14.0,
            wordWrap="CJK",
            textColor=colors.black,
        ),
    }

    def p(text: str, style: str = "body") -> Paragraph:
        return Paragraph(text.replace("\n", "<br/>"), styles[style])

    def styled_table(rows, widths):
        table = Table(rows, colWidths=widths, splitByRow=1)
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), "ReportMincho"),
                    ("FONTNAME", (0, 0), (0, -1), "ReportGothic"),
                    ("FONTSIZE", (0, 0), (-1, -1), 10.5),
                    ("LEADING", (0, 0), (-1, -1), 14.1),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return table

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=11 * mm,
        bottomMargin=9 * mm,
    )

    screenshot = RLImage(str(SCREENSHOT_PATH), width=31 * mm, height=68 * mm)

    page1_rows = [
        [
            "アプリ概要",
            p(
                "基本情報技術者試験の学習アプリ「FE Learning OS」に、用語暗記用のセンサ機能を追加した。"
                "問いは表示したまま、自分で書いた記述だけを隠し、答えを思い出した後に端末の傾きまたは手動ボタンで確認する。"
                "既存の学習履歴やメモは残し、センサ値そのものは保存しない。"
            ),
        ],
        [
            "必須要件への対応",
            p(
                "スマートフォン内蔵の端末方向センサを1種類以上使用した。センサ値の表示に加え、傾き量をゲージで可視化し、"
                "しきい値を超えたかどうかを判定して現在の用語の答えだけを表示する操作を実装した。提出形式はindex.htmlの"
                "1ファイルで完結する構成とし、GitHub公開や動作動画がなくても確認できる内容にした。"
            ),
        ],
        [
            "使用センサ",
            p(
                "DeviceOrientationEventからbeta（前後方向）とgamma（左右方向）を取得する。暗記開始時または再調整時の姿勢を基準にし、"
                "現在値との差分から傾き量を計算する。表示開始は約25度、非表示へ戻す目安は約10度とし、短い揺れで反応しないよう"
                "維持時間を入れた。iPhone Safariではセンサ操作ONのボタンから許可要求を行う。"
            ),
        ],
        [
            "画面・動作",
            Table(
                [
                    [
                        screenshot,
                        p(
                            "スクリーンショットはマップ画面で暗記モードをONにした状態である。自分の記述は覆いで隠れ、"
                            "センサ操作をONにすると基準との差、現在の状態、表示までの残り角度が出る。端末を意図的に傾け、"
                            "条件を満たした時だけ現在の用語の記述が一時表示され、通常姿勢へ戻すと再び隠れる。"
                        ),
                    ]
                ],
                colWidths=[34 * mm, 103 * mm],
                style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
            ),
        ],
        [
            "デザインポリシー",
            p(
                "スマートフォンで片手操作しやすいよう、暗記モード、センサ操作、再調整、手動表示を近い位置へまとめた。"
                "状態は色だけでなく「センサON」「答えを隠しています」「あと25度」などの文字でも示す。"
                "ボタンは44px以上を目安にし、暗い画面でも読める高コントラストにした。"
            ),
        ],
        [
            "動作確認",
            p(
                "自分のiPhoneでSafariまたはホーム画面に追加したPWAとして確認した。暗記モードONで記述が隠れ、手動ボタンで表示できた。"
                "センサ操作ONでは端末を傾けると基準との差が変化し、条件を満たした時だけ答えが表示された。"
                "問題点は、iPhoneではセンサ許可とHTTPSが必要なこと、拒否時はボタン操作へ切り替える必要があることである。"
            ),
        ],
        [
            "安全性",
            p(
                "センサ値は画面表示と判定のためだけに使い、localStorage、サーバ、外部サービスへ保存・送信しない。"
                "傾きの履歴、基準姿勢、beta/gammaの生データは保存しない。外部通信、アクセス解析、カメラ、マイク、位置情報は使わない。"
            ),
        ],
    ]

    page2_rows = [
        ["使用した生成AI", p("ChatGPTとCodexを使用した。文章整理、実装方針の検討、コード作成、修正案の確認に利用した。")],
        ["モデル名", p("GPT-5系のCodexを使用した。必要に応じてChatGPT上で説明文や確認観点の整理も行った。")],
        [
            "チャット記録",
            p(
                "制作過程を確認できる主要なチャット共有リンクを提出時に貼る。記録には、端末方向センサを使った暗記モード、"
                "iPhone Safariの許可処理、安全性、PWAキャッシュ、長押し操作の修正について相談した内容を含める。"
            ),
        ],
        [
            "AIへの指示",
            p(
                "既存のFE Learning OSを壊さず、スマートフォン内蔵センサを使って暗記モードを追加するよう指示した。"
                "具体的には、暗記モードONで自分の記述を隠すこと、端末を一定以上傾けた時だけ現在の用語の答えを表示すること、"
                "センサが使えない場合でも長押しまたはタップで表示できること、センサ値を保存・送信しないことを条件にした。"
            ),
        ],
        [
            "確認・修正",
            p(
                "AIが出したコードをそのまま使わず、実際のiPhone利用を想定して修正した。DeviceOrientationEvent.requestPermission()を"
                "ユーザー操作内で呼ぶようにし、暗記モードOFF時はセンサ操作を選べないようにした。センサ拒否や非対応時にはクラッシュさせず、"
                "ボタン操作のみへ戻すようにした。また、状態を色だけに頼らず文字ラベルでも示し、iOSの長押し選択が邪魔になる箇所は"
                "選択不可にした。"
            ),
        ],
        [
            "提出要件との照合",
            p(
                "端末方向センサを1種類以上使用し、値の表示、ゲージによる可視化、しきい値判定、答え表示操作を実装した。"
                "index.htmlの1ファイルで完結する提出形式に合わせ、公開URLや動画提出がなくても説明できる構成にした。"
                "自分のスマートフォンで一度以上確認し、確認環境と問題点を1ページ目に記載した。"
            ),
        ],
    ]

    story = [
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題: スマートフォンセンサ Web アプリの制作（30点） / 1ページ目: 制作内容", "subtitle"),
        styled_table(page1_rows, [34 * mm, 137 * mm]),
        PageBreak(),
        p("2026年度「センサと計測」最終レポート", "title"),
        p("B課題: スマートフォンセンサ Web アプリの制作（30点） / 2ページ目: AI利用記録", "subtitle"),
        styled_table(page2_rows, [37 * mm, 134 * mm]),
    ]

    doc.build(story)


if __name__ == "__main__":
    make_screenshot()
    make_pdf()
    print(f"{PDF_PATH} pages={len(PdfReader(str(PDF_PATH)).pages)}")
