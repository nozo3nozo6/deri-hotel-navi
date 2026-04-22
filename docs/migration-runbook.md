# yobuho.com サーバー移行Runbook

**目的**: シンレンタルサーバー sv6825 → 新サーバー(sv6XXX) への切替を、閲覧者影響を最小化して実行する。
**申請日時**: 2026-04-21 02:40 JST
**ライフサイクル**: カットオーバー完了・24h監視クリア後、このファイル削除。

---

## 0. 全体ポリシー

- **NSはCloudflareにある** → Shin「サーバー切替」画面のDNS操作は**無効**。Cloudflareを直接触る。
- **A recordは全てProxied** → TTL待ち不要。Cloudflare A変更は**即反映**。
- **閲覧者影響を最小化**: /api/ POSTのみ `.maintenance` で503。GET閲覧は通常通り。
- **旧サーバーは即停止しない**: カットオーバー後24hはロールバック可能状態で維持。

---

## 1. サーバー情報

### 現行（旧）
| 項目 | 値 |
|---|---|
| ホスト名 | `sv6825.wpx.ne.jp` |
| IP（A record値）| `210.157.79.215` |
| SSHポート | `10022` |
| SSHユーザー | `yobuho` |
| 秘密鍵 | `~/.ssh/yobuho_deploy`（パスフレーズなし） |
| WebDocRoot | `/home/yobuho/yobuho.com/public_html/` |
| DBホスト（PHP内） | `localhost` |

### 新サーバー（判明: 2026-04-21 13:00）
| 項目 | 値 |
|---|---|
| ホスト名 | `sv6051.wpx.ne.jp` |
| IP | `162.43.96.7` |
| SSHポート | `10022`（Shin共通） |
| SSHユーザー | `yobuho`（アカウントID不変） |
| 秘密鍵 | `~/.ssh/yobuho_deploy`（Shin簡単移行で自動引き継ぎのはず、要確認） |
| MariaDB | 10.11 （旧: 10.5） |
| CPU | AMD EPYC 9534 x 2 （アップグレード） |
| メモリ | 1536GB （旧: 1024GB、アップグレード） |

---

## 2. Cloudflare DNS

### 変更対象（カットオーバー時に書き換える3件）
| Type | Name | 現在 | 変更後 | Proxy |
|---|---|---|---|---|
| A | `yobuho.com` | `210.157.79.215` | `162.43.96.7` | 🟠 Proxied |
| A | `www` | `210.157.79.215` | `162.43.96.7` | 🟠 Proxied |
| A | `*` | `210.157.79.215` | `162.43.96.7` | 🟠 Proxied |

### 触らない（変更不要）
- MX: yobuho.com → メール受信は新旧どちらで受けるかShin側制御
- TXT `_dmarc`: `v=DMARC1; p=reject; sp=reject;...` ← 維持
- TXT `google-site-verification`
- Worker route: `chat.yobuho.com` → yobuchat-do ← サーバー切替の影響ゼロ

---

## 3. SPF（3段階書き換え）

### Stage A（コピー開始通知後、すぐ）
```
v=spf1 +a:sv6825.wpx.ne.jp +a:sv6051.wpx.ne.jp ~all
```
**理由**: どちらのサーバーから送信してもDMARC p=rejectで弾かれないようにする保険。

### Stage B（カットオーバー直前、任意）
変更なし（Aのまま）。

### Stage C（24h監視クリア後）
```
v=spf1 +a:sv6051.wpx.ne.jp ~all
```
sv6825参照を除去。

---

## 4. DKIM

### 現状確認
Cloudflare `TXT default._domainkey.yobuho.com` の値を**スクショで保存**（パネル復活後）。

### 新サーバー側の設定
- Shin新パネル → メール設定 → DKIM → yobuho.com ON
- **新DKIM公開鍵**が発行される → Cloudflare `default._domainkey` を書き換え

### 検証
```bash
dig +short TXT default._domainkey.yobuho.com
# 新サーバーからのテストメール → Gmail受信 → "DKIM: PASS" 確認
```

---

## 5. GitHub Secrets 変更一覧

カットオーバー時に変更:
| Key | 現在 | 変更後 |
|---|---|---|
| `SSH_HOST` | `sv6825.wpx.ne.jp` | `sv6051.wpx.ne.jp` |
| `DB_HOST` | `localhost` | `localhost`（変更なしの可能性が高い） |
| `DB_NAME` | `<現在値>` | 新パネルで確認 |
| `DB_USER` | `<現在値>` | 新パネルで確認 |
| `DB_PASS` | `<現在値>` | 新パネルで確認 |

※ GitHub → Settings → Secrets and variables → Actions で書き換え。

---

## 6. カットオーバー手順（本番）

### 実施タイミング
データコピー**完了通知**を受けた後、深夜帯（JST 2:00-5:00推奨）。

### T-60分: 事前確認
```bash
# 新サーバーへのSSH接続確認
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@<新サーバー> "hostname; uptime"

# 新サーバーのDB接続確認
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@<新サーバー> \
  "mysql -u<USER> -p<PASS> <DB> -e 'SELECT COUNT(*) FROM shops;'"

# 新サーバーのSSL確認（hostsで暫定）
# Mac側: /etc/hosts に `<新IP> yobuho.com` 追記
curl -I https://yobuho.com/
# → 200返ればOK。検証後 hosts を戻す
```

### T-10分: SPF二重許可が入っていることを確認
```bash
dig +short TXT yobuho.com | grep spf
# → "v=spf1 +a:sv6825.wpx.ne.jp +a:sv6051.wpx.ne.jp ~all" が出るはず
```

### T-0: メンテモード投入（旧サーバー）
```bash
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6825.wpx.ne.jp \
  "touch /home/yobuho/yobuho.com/public_html/.maintenance"
```
**効果**: /api/ への POST/PUT/DELETE が 503。GET は通常通り。

### T+1分: 旧サーバーから最新DBをdump
**重要**: ここで取るdumpがすべて。Shinのデータコピー（申請時点のスナップショット）は上書きされて消える。
```bash
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6825.wpx.ne.jp \
  "mysqldump --single-transaction --quick --default-character-set=utf8mb4 \
   --add-drop-table --routines --triggers --events \
   -u<USER> -p<PASS> <DB> > /tmp/yobuho_cutover.sql && \
   wc -l /tmp/yobuho_cutover.sql && \
   ls -lh /tmp/yobuho_cutover.sql"
```
- `--add-drop-table`: restore時に既存テーブルをDROPしてから再作成（2:40スナップショットを確実に上書き）
- `--routines --triggers --events`: ストアドプロシージャ/トリガー/イベントも含める

### T+3分: 新サーバーへ転送 + restore
```bash
# 旧→新 直接転送（旧サーバー上で実行）
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6825.wpx.ne.jp \
  "scp -P 10022 /tmp/yobuho_cutover.sql yobuho@<新サーバー>:/tmp/"

# 新サーバーで restore
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@<新サーバー> \
  "mysql -u<USER> -p<PASS> <DB> < /tmp/yobuho_cutover.sql && \
   mysql -u<USER> -p<PASS> <DB> -e 'SELECT COUNT(*) FROM shops;'"
```

### T+5分: Cloudflare A record 書き換え（3件）
Cloudflare Dashboard → DNS → A records 3件（yobuho.com / www / *）を `162.43.96.7` に変更。
Proxied 🟠 維持。

### T+6分: メンテモード解除（旧・新両方）
```bash
# 新サーバーで（念のため）
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@<新サーバー> \
  "rm -f /home/yobuho/yobuho.com/public_html/.maintenance"

# 旧サーバーで（ロールバック用に残すのもアリだが、通常解除）
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6825.wpx.ne.jp \
  "rm /home/yobuho/yobuho.com/public_html/.maintenance"
```

### T+7分: GitHub Secrets 更新
- `SSH_HOST` を新ホスト名に変更
- (必要なら) DB関連も更新

---

## 7. 動作確認チェックリスト（カットオーバー直後）

- [ ] `curl -I https://yobuho.com/` → 200
- [ ] `curl -I https://www.yobuho.com/` → 200
- [ ] `curl -I https://deli.yobuho.com/` → 200
- [ ] `curl -I https://jofu.yobuho.com/` → 200
- [ ] `curl -I https://same.yobuho.com/` → 200
- [ ] `curl -I https://loveho.yobuho.com/` → 200
- [ ] `curl -I https://este.yobuho.com/` → 200
- [ ] `curl -I https://chat.yobuho.com/` → 200（Worker、影響なしのはず）
- [ ] ポータルで検索動作（/api/hotels.php 呼び出し確認）
- [ ] ホテル詳細ページ表示（/api/hotel-detail.php）
- [ ] 店舗ログイン試行（/api/shop-auth.php）
- [ ] 口コミ投稿試行（/api/submit-report.php）
- [ ] Magic Linkメール送信テスト（shop-registerから）→ Gmailで受信+SPF/DKIM/DMARC PASS確認
- [ ] cron 動作確認: `curl "https://yobuho.com/api/chat-retention.php?key=<SECRET>"` → `ok:true`
- [ ] chat動作確認（chat-widget埋込サンプル or 実店舗）
- [ ] admin管理画面ログイン
- [ ] GitHub Actions デプロイテスト（空コミットpushして通るか）

---

## 8. ロールバック手順（切り戻し）

**判断基準**: 致命的不具合（DB接続失敗/多数のサブドメイン500/メール全滅）を5分以内に発見した場合。

```bash
# 1. Cloudflare A record 3件を `210.157.79.215` に戻す
#    （ダッシュボードで即変更、Proxiedなので1分以内に反映）

# 2. 旧サーバーの .maintenance を削除
ssh -p 10022 -i ~/.ssh/yobuho_deploy yobuho@sv6825.wpx.ne.jp \
  "rm -f /home/yobuho/yobuho.com/public_html/.maintenance"

# 3. GitHub Secrets の SSH_HOST を sv6825 に戻す

# 4. カットオーバー後に新サーバーに入った投稿の差分を旧に反映
#    （メンテモードで旧への書き込みは止めてあるので、新DB→旧DBの差分マージ）
ssh -p 10022 yobuho@<新サーバー> \
  "mysqldump ... chat_sessions chat_messages reports loveho_reports > /tmp/diff.sql"
# → 旧サーバーで reload（差分のみUPSERT）
```

---

## 9. 監視（24時間）

### 機械監視
- UptimeRobot（5分間隔）: yobuho.com メインURL
- Google Search Console: サーチ結果のindex status（数日かかる）

### 手動監視（カットオーバー後 1h / 6h / 24h）
- Cloudflare Analytics → 5xx エラー率の推移
- Gmail で DMARC レポート（postmaster@ 宛）
- ログイン失敗率（auth.php の rate limit 発動状況）
- chat 着信通知メール到達確認

---

## 10. 移行完了後の片付け

カットオーバー完了 + 24h監視クリア後:

- [ ] SPF Stage C（sv6825除去）適用
- [ ] ドキュメント内 `sv6825` 参照を一括置換:
  - `CLAUDE.md` 4箇所
  - `docs/ARCHITECTURE.md` 2箇所
  - `db-local.js` コメント1箇所
  - `scripts/*.js` 17ファイル
  - `api/process-bounces.php` コメント1箇所
- [ ] このファイル（`docs/migration-runbook.md`）を削除
- [ ] 旧サーバー（sv6825）の解約手続き（Shinの別メニュー）

---

## 11. 判明待ち情報（コピー開始通知後に埋める）

- [ ] 新サーバーホスト名: `sv6051.wpx.ne.jp`
- [ ] 新サーバーIP: `dig +short sv6051.wpx.ne.jp`
- [ ] DB接続情報（DBホスト/名/ユーザー/パス）— 通常変わらないが念のため確認
- [ ] 新サーバーへの公開鍵登録済みかの確認（`~/.ssh/authorized_keys`）
- [ ] cron設定の引き継ぎ確認（Shinは自動引き継ぎの場合が多いが要確認）
- [ ] DKIM公開鍵が新旧で一致するかの確認
