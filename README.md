# Hướng dẫn cài đặt

## Backend

### 1. Tạo môi trường ảo Python (khuyến nghị)

```bash
# Tạo virtualenv
python -m venv venv

# Kích hoạt (Linux / macOS)
source venv/bin/activate

# Kích hoạt (Windows)
venv\Scripts\activate
```

### 2. Cài đặt dependencies

```bash
pip install -r requirements.txt
```

### 3. Cấu hình biến môi trường

Tạo file `.env` trong thư mục `backend/`:

```bash
# backend/.env
# === Backend Cloud Monitoring ===

# Gemini API (cho AI agent phan tich log)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL_PRIMARY=gemini-3.6-flash
GEMINI_MODEL_FALLBACK=gemini-3.5-flash
GEMINI_MODEL_LAST=gemini-flash-lite-latest

# GitHub Actions integration (goi pipeline)
GITHUB_TOKEN=github_api_key
GITHUB_REPO=tnghuay/pipeline_test
WORKFLOW_FILE=actions.yml
WORKFLOW_REF=test

# S3 doc ket qua 
S3_BUCKET=scanning-result-bucket
S3_PREFIX=customers
S3_REGION=ap-southeast-1
S3_READ_ACCESS_KEY_ID=
S3_READ_SECRET_ACCESS_KEY=

# Elasticsearch / ELK live data
ELASTICSEARCH_URL=https://192.168.48.10:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your_elasticsearch_password
ELASTICSEARCH_VERIFY_TLS=false
ELASTIC_LOG_INDEX=filebeat-*
ELASTIC_ALERT_INDEX=.alerts-security.alerts-default

```

Lấy API key tại: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

### 4. Chạy server

```bash
uvicorn app:app --reload
```

### 5. Test API

Trên trình duyệt truy cập: [http://localhost:8000/docs](http://localhost:8000/docs)

### 6. AI diễn giải kết quả quét (Tầng 2)

Backend đọc các tệp kết quả quét từ S3 — giống dữ liệu dashboard đang hiển thị:
`merged-results.json`, `kics-results.json`, `trivy-results.json` (và `iac.zip` nếu pipeline có upload). Dữ liệu được che bí mật, rồi gọi Gemini để:

1. Tổng quan lỗ hổng theo nhóm (số lượng/severity do backend tính từ scanner).
2. Gộp remediation của KICS thành các khối khuyến nghị theo thứ tự ưu tiên.

| Endpoint | Mô tả |
|---|---|
| `GET /api/ai/status` | Kiểm tra đã cấu hình `GEMINI_API_KEY` chưa |
| `POST /api/ai/analyze/{customer_id}` | Phân tích lần quét mới nhất (cache theo lần quét) |
| `POST /api/ai/analyze/{customer_id}?force=true` | Bỏ cache, phân tích lại |

Kết quả AI chỉ chứa phần diễn giải; mọi con số và khuyến nghị đều truy vết về finding gốc trong kết quả quét. Dữ liệu gửi Gemini đã được che khóa AWS, token GitHub/Slack, private key, JWT...

**Tự động phân tích:** sau khi pipeline quét xong, dashboard tự tải kết quả từ S3, gọi Gemini và mở trang **Phân tích AI** (thay cho mục "Tài nguyên" cũ). Trang này hiển thị tổng quan theo nhóm, khuyến nghị ưu tiên và các finding gốc để truy vết. Có thể bấm "Phân tích lại" để bỏ cache.

---

## Frontend

```bash
npm install
npm start
```
