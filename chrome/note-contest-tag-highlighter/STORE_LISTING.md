# Chrome Web Store listing draft

This is the Japanese listing draft for the current Japanese-language UI. Update it if the extension's behavior or data handling changes.

## Product details

- **Name:** note Contest Tag Highlighter
- **Language:** Japanese
- **Category:** Workflow & Planning (recommended; confirm the available category label in the dashboard)
- **Short description:** note.comの記事公開設定画面で、お題・コンテスト対象のハッシュタグをハイライトします。
- **Distribution:** Public, free; Japan is the recommended initial region.

## Detailed description

note.comの記事公開設定画面で、お題やコンテストに関連するハッシュタグを見つけやすくします。

note.comの公開ページに掲載されたコンテスト・お題のタグ情報を取得し、記事の公開設定画面で選択中のタグや入力候補と照合します。一致したタグは緑色でハイライトされます。ポップアップでは対象タグ数と最終更新日時を確認でき、タグ情報を手動で更新できます。

タグ情報は約24時間ごとに更新されます。取得したタグ一覧はこのブラウザ内に保存します。

本拡張機能はnote.comとは独立して提供されており、note株式会社の公式・公認サービスではありません。

### Privacy

利用への同意後、拡張機能は note.com の記事公開設定画面のURLと画面上のテキストを読み取り、ハッシュタグを見つけてブラウザ内で照合します。記事のURLや画面上のテキストを開発者や第三者へ送信・保存しません。公開タグ一覧は note.com から取得します。詳しくは [プライバシーポリシー](PRIVACY_POLICY.md) をご覧ください。

This is an independent extension and is not affiliated with or endorsed by note.com.

## Single-purpose statement for the Privacy practices tab

note Contest Tag Highlighter helps users identify hashtags matching current note.com contests and themes on the article publishing screen by highlighting exact matches.

## Data-use disclosure for the Privacy practices tab

The extension handles the current note.com editor URL path and visible page text to locate hashtags on the article publishing screen, only after the user gives affirmative consent in the popup. It processes the extracted hashtag strings locally to highlight matching tags. It does not store or transmit the URL or page text. It downloads the public tag list from note.com and stores that list locally. No data is sold, shared with the developer, used for advertising, or used for analytics.

Select the dashboard data categories corresponding to **web browsing activity** (the note.com editor URL path) and **website content / user-generated content** (visible hashtag text). Do not certify that the extension handles no user data.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `alarms` | Refreshes the public tag list about once every 24 hours. |
| `offscreen` | Parses the fetched public contests page in an offscreen document without running its scripts. |
| `storage` | Stores the public tag cache and the user's consent state locally. |
| `webNavigation` | Detects same-document route changes on note.com editor pages so highlighting starts on the publishing screen and stops when leaving it. The event listener is filtered to `editor.note.com/notes/*` and processing is disabled until consent. |
| `scripting` | Injects the extension's own content script and stylesheet into an already-open note.com editor tab when no content-script listener is available. Host permissions restrict this to note.com pages. |
| `https://note.com/contests*` | Fetches the public contest and theme tag list. |
| `https://editor.note.com/notes/*` | Runs the consent-gated tag matching feature on note.com article editor pages and supports SPA route changes. |

The broad `tabs` permission is not requested. Matching note.com host permissions scope access to the relevant tabs.

## Other dashboard fields

- **Remote code:** No. All extension code is included in the uploaded package; fetched HTML is parsed as data only.
- **Privacy policy URL:** `https://github.com/tacoyaky/pocket-lab/blob/main/chrome/note-contest-tag-highlighter/PRIVACY_POLICY.md`
- **Homepage URL:** `https://github.com/tacoyaky/pocket-lab/tree/main/chrome/note-contest-tag-highlighter`
- **Support URL:** `https://github.com/tacoyaky/pocket-lab/issues`
- **Test instructions:** A note.com account is needed to open the article publishing settings screen. The reviewer can use their own account; no developer credentials are provided.
- **Content rating:** Not mature.

## Developer account setup

- Register a Chrome Web Store developer account, accept the developer agreement, and pay the one-time registration fee.
- Use a monitored developer email. Google's setup guide says the email cannot be changed after account creation.
- The publisher display name and contact details are chosen in the developer account and are intentionally not recorded in this repository.

## Before submitting

- Confirm the public repository and privacy-policy URL are available on the default branch.
- Add at least one real, current 1280×800 or 640×400 screenshot of the extension working. The image must show the actual user experience; do not use a mockup. Hide account details, article titles, and private content.
- Complete the developer account, data-use declarations, payment/visibility, and region fields in the Developer Dashboard.
- Confirm the dashboard's required asset fields. Current image guidance requires a 440×280 small promotional tile and at least one screenshot; a marquee tile is optional. Dashboard documentation differs on whether a promo video is required, so follow the live form.
