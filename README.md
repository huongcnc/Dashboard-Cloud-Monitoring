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

---

## Frontend

```bash
npm install
npm start
```
