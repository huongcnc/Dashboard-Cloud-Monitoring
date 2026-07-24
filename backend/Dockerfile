FROM python:3.12-slim

WORKDIR /app

# Cai dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# Tao thu mục log
RUN mkdir -p log

# Expose port backend
EXPOSE 8000

# Chay uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]