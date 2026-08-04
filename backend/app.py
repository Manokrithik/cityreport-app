import os
import sqlite3
import random
import smtplib
import requests
from email.mime.text import MIMEText
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from datetime import datetime
import uuid
import jwt
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

# Serve frontend files from the parent directory
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
CORS(app)

DB_FILE = 'civic_reports.db'
UPLOAD_FOLDER = 'uploads'
SECRET_KEY = 'super-secret-city-key'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Reports table with user_id
    c.execute('''
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            category TEXT,
            description TEXT,
            lat REAL,
            lng REAL,
            photo_path TEXT,
            status TEXT,
            upvotes INTEGER,
            timestamp DATETIME,
            is_anonymous BOOLEAN,
            user_id TEXT
        )
    ''')
    
    # Users table for civic points
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            points INTEGER DEFAULT 0
        )
    ''')
    
    # Migration if upgrading from V1
    try:
        c.execute('ALTER TABLE reports ADD COLUMN user_id TEXT')
    except sqlite3.OperationalError:
        pass # Column already exists
        
    # Migration for V3 (Resolution Photo)
    try:
        c.execute('ALTER TABLE reports ADD COLUMN resolution_photo_path TEXT')
    except sqlite3.OperationalError:
        pass # Column already exists
        
    # Migration for V4 (Read Receipts)
    try:
        c.execute('ALTER TABLE reports ADD COLUMN is_read BOOLEAN DEFAULT 0')
    except sqlite3.OperationalError:
        pass # Column already exists
        
    # Notifications Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            message TEXT,
            is_read BOOLEAN DEFAULT 0,
            timestamp DATETIME
        )
    ''')
    
    # OTPs Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS otps (
            identifier TEXT PRIMARY KEY,
            otp TEXT,
            timestamp DATETIME
        )
    ''')
        
    conn.commit()
    conn.close()

init_db()

# --- S3 Adapter Mock ---
def upload_to_s3_mock(photo, filename):
    """
    Mock adapter for AWS S3. 
    Currently saves locally. To switch to real S3, replace this body with boto3.
    """
    photo_path = os.path.join(UPLOAD_FOLDER, filename)
    photo.save(photo_path)
    return photo_path

# --- Auth Middleware ---
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token or not token.startswith('Bearer '):
            return jsonify({"error": "Token is missing"}), 403
        try:
            data = jwt.decode(token.split(' ')[1], SECRET_KEY, algorithms=["HS256"])
            if data['role'] != 'admin':
                raise Exception("Not admin")
        except:
            return jsonify({"error": "Token is invalid"}), 403
        return f(*args, **kwargs)
    return decorated

# --- Routes ---

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    if data and data.get('username') == 'admin' and data.get('password') == 'admin':
        token = jwt.encode({'user': 'admin', 'role': 'admin'}, SECRET_KEY, algorithm='HS256')
        return jsonify({'token': token})
    return jsonify({"error": "Invalid credentials"}), 401

def send_email_otp(email, otp):
    user = os.environ.get('GMAIL_USER')
    password = os.environ.get('GMAIL_APP_PASSWORD')
    if not user or not password or user == 'your_email@gmail.com':
        print(f"[WARNING] Missing GMAIL credentials. OTP for {email} is: {otp}")
        return
        
    try:
        msg = MIMEText(f"Your CityReport login code is: {otp}")
        msg['Subject'] = 'CityReport OTP'
        msg['From'] = user
        msg['To'] = email

        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(user, password)
        server.send_message(msg)
        server.quit()
        print(f"[OK] OTP sent to email: {email}")
    except Exception as e:
        print(f"[ERROR] Failed to send email OTP to {email}: {e}")
        print(f"[FALLBACK] OTP for {email} is: {otp}")

def send_sms_otp(phone, otp):
    sid = os.environ.get('N8N_WEBHOOK_URL')
    
    
    
        if not sid:
        print(f"[WARNING] N8N_WEBHOOK_URL not set. OTP for {phone} is: {otp}")
        return
        
    try:
                res = requests.post(sid, json={"phone": phone, "otp": otp})
        
        
            
            
            

        
        if res.status_code in [200, 201]:
            print(f"[OK] OTP sent to SMS: {phone}")
        else:
            print(f"[ERROR] Webhook Error: {res.text}")
            print(f"[FALLBACK] OTP for {phone} is: {otp}")
    except Exception as e:
        print(f"[ERROR] Failed to send SMS OTP to {phone}: {e}")
        print(f"[FALLBACK] OTP for {phone} is: {otp}")

@app.route('/api/request_otp', methods=['POST'])
def request_otp():
    data = request.json
    phone = data.get('phone')
    email = data.get('email')
    
    identifier = phone if phone else email
    if not identifier:
        return jsonify({"error": "Identifier required"}), 400
        
    # Generate 4-digit OTP
    otp = str(random.randint(1000, 9999))
    
    # Save OTP to DB
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('INSERT OR REPLACE INTO otps (identifier, otp, timestamp) VALUES (?, ?, ?)', 
              (identifier, otp, datetime.now()))
    conn.commit()
    conn.close()
    
    if email:
        send_email_otp(email, otp)
    else:
        send_sms_otp(phone, otp)
        
    return jsonify({"message": "OTP sent"})

@app.route('/api/citizen_login', methods=['POST'])
def citizen_login():
    data = request.json
    phone = data.get('phone')
    email = data.get('email')
    otp_input = data.get('otp')
    
    identifier = phone if phone else email
    
    if not identifier or not otp_input:
        return jsonify({"error": "Identifier and OTP required"}), 400
        
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # If using backdoor for testing without keys
    if otp_input == '1234':
        is_valid = True
    else:
        c.execute('SELECT otp FROM otps WHERE identifier = ?', (identifier,))
        row = c.fetchone()
        is_valid = row and row[0] == str(otp_input)
        
    if is_valid:
        user_id = f"user_{identifier}"
        token = jwt.encode({'user': user_id, 'role': 'citizen'}, SECRET_KEY, algorithm='HS256')
        
        c.execute('INSERT OR IGNORE INTO users (id, points) VALUES (?, 0)', (user_id,))
        # Optional: delete OTP after use
        c.execute('DELETE FROM otps WHERE identifier = ?', (identifier,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'token': token, 'user_id': user_id})
        
    conn.close()
    return jsonify({"error": "Invalid OTP"}), 401

@app.route('/api/reports', methods=['GET'])
def get_reports():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT id, category, description, lat, lng, photo_path, status, upvotes, timestamp, is_anonymous, user_id, resolution_photo_path, is_read FROM reports ORDER BY timestamp DESC')
    rows = c.fetchall()
    conn.close()
    
    reports = []
    for row in rows:
        reports.append({
            'id': row[0],
            'category': row[1],
            'description': row[2],
            'lat': row[3],
            'lng': row[4],
            'photo_path': row[5],
            'status': row[6],
            'upvotes': row[7],
            'timestamp': row[8],
            'is_anonymous': bool(row[9]),
            'user_id': row[10],
            'resolution_photo_path': row[11],
            'is_read': bool(row[12]) if row[12] is not None else False
        })
    return jsonify(reports)

@app.route('/api/reports', methods=['POST'])
def create_report():
    data = request.form
    photo = request.files.get('photo')
    
    report_id = str(uuid.uuid4())
    photo_path = None
    
    if photo:
        filename = f"{report_id}_{photo.filename}"
        photo_path = upload_to_s3_mock(photo, filename)

    category = data.get('category', 'other')
    description = data.get('description', '')
    lat = float(data.get('lat', 0.0))
    lng = float(data.get('lng', 0.0))
    is_anonymous = data.get('is_anonymous', 'true').lower() == 'true'
    user_id = data.get('user_id', 'anonymous')
    
    emergency_keywords = ['fire', 'accident', 'gun', 'blood', 'emergency', 'help']
    if any(word in description.lower() for word in emergency_keywords):
        return jsonify({"error": "Emergency detected."}), 400

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        INSERT INTO reports (id, category, description, lat, lng, photo_path, status, upvotes, timestamp, is_anonymous, user_id, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ''', (report_id, category, description, lat, lng, photo_path, 'open', 0, datetime.now(), is_anonymous, user_id))
    
    # Ensure user exists for points
    c.execute('INSERT OR IGNORE INTO users (id, points) VALUES (?, 0)', (user_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Report created successfully", "id": report_id}), 201

@app.route('/api/reports/<report_id>/upvote', methods=['POST'])
def upvote_report(report_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('UPDATE reports SET upvotes = upvotes + 1 WHERE id = ?', (report_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Upvoted successfully"}), 200

@app.route('/api/reports/<report_id>/status', methods=['PUT'])
@admin_required
def update_status(report_id):
    data = request.json
    new_status = data.get('status')
    
    if new_status not in ['open', 'in_progress', 'resolved']:
        return jsonify({"error": "Invalid status"}), 400

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Get current status and user_id to award points if newly resolved
    c.execute('SELECT status, user_id FROM reports WHERE id = ?', (report_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Report not found"}), 404
        
    old_status, user_id = row
    
    c.execute('UPDATE reports SET status = ? WHERE id = ?', (new_status, report_id))
    
    # Award 50 Civic Points if status changed to resolved
    if new_status == 'resolved' and old_status != 'resolved':
        c.execute('UPDATE users SET points = points + 50 WHERE id = ?', (user_id,))
        
    conn.commit()
    conn.close()
    
    return jsonify({"message": f"Status updated to {new_status}"}), 200

@app.route('/api/reports/<report_id>/read', methods=['PUT'])
@admin_required
def mark_as_read(report_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Get user_id to notify
    c.execute('SELECT user_id, is_read FROM reports WHERE id = ?', (report_id,))
    row = c.fetchone()
    
    if row and not row[1]:
        user_id = row[0]
        notif_id = str(uuid.uuid4())
        c.execute('INSERT INTO notifications (id, user_id, message, timestamp) VALUES (?, ?, ?, ?)', 
                  (notif_id, user_id, "The city has viewed your report! 👀", datetime.now()))

    c.execute('UPDATE reports SET is_read = 1 WHERE id = ?', (report_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Marked as read"}), 200

@app.route('/api/reports/<report_id>/resolve', methods=['POST'])
@admin_required
def resolve_report(report_id):
    photo = request.files.get('resolution_photo')
    if not photo:
        return jsonify({"error": "Resolution photo is required."}), 400
        
    filename = f"resolved_{report_id}_{photo.filename}"
    photo_path = upload_to_s3_mock(photo, filename)
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT status, user_id FROM reports WHERE id = ?', (report_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Report not found"}), 404
        
    old_status, user_id = row
    
    c.execute('UPDATE reports SET status = ?, resolution_photo_path = ? WHERE id = ?', ('resolved', photo_path, report_id))
    
    # Award 50 Civic Points if status changed to resolved
    if old_status != 'resolved':
        c.execute('UPDATE users SET points = points + 50 WHERE id = ?', (user_id,))
        notif_id = str(uuid.uuid4())
        c.execute('INSERT INTO notifications (id, user_id, message, timestamp) VALUES (?, ?, ?, ?)', 
                  (notif_id, user_id, "Your report was resolved! Proof photo uploaded and you earned +50 Civic Points! 🎉", datetime.now()))
        
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Report resolved successfully"}), 200

@app.route('/api/notifications/<user_id>', methods=['GET'])
def get_notifications(user_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT id, message, is_read, timestamp FROM notifications WHERE user_id = ? ORDER BY timestamp DESC', (user_id,))
    rows = c.fetchall()
    conn.close()
    
    notifs = []
    for row in rows:
        notifs.append({
            'id': row[0],
            'message': row[1],
            'is_read': bool(row[2]),
            'timestamp': row[3]
        })
    return jsonify(notifs)

@app.route('/api/users/<user_id>/points', methods=['GET'])
def get_points(user_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT points FROM users WHERE id = ?', (user_id,))
    row = c.fetchone()
    conn.close()
    
    points = row[0] if row else 0
    return jsonify({"points": points})

# --- SERVE FRONTEND ---
@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # Don't serve backend files
    if path.startswith('backend'):
        return jsonify({"error": "Not found"}), 404
    file_path = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(file_path):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, 'index.html')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
