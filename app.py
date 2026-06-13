import os
import uuid
import time
import threading
from flask import Flask, request, jsonify, render_template, send_file, session
from werkzeug.utils import secure_filename
import PyPDF2
from test_genai import genai
from google.genai import types
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.colors import HexColor

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['GENERATED_FOLDER'] = 'generated'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

ALLOWED_EXTENSIONS = {'pdf'}

# Store document text in memory (keyed by session)
document_store = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(filepath):
    text = ""
    with open(filepath, 'rb') as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            text += page.extract_text() + "\n"
    return text

# Models tried in order — falls back if one is rate-limited
GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
]

def call_gemini(prompt_text):
    """Call Gemini with automatic model fallback and retry on 429."""
    api_key = os.environ.get('GEMINI_API_KEY', '')
    if not api_key:
        return None  # caller handles demo mode

    client = genai.Client(api_key=api_key)

    for model in GEMINI_MODELS:
        # Retry up to 3 times per model with exponential backoff
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt_text
                )
                return response.text
            except Exception as e:
                err = str(e)
                if '429' in err or 'RESOURCE_EXHAUSTED' in err:
                    # Extract retry delay from error if present, else use backoff
                    wait = (2 ** attempt) * 5  # 5s, 10s, 20s
                    if attempt < 2:
                        time.sleep(wait)
                        continue  # retry same model
                    else:
                        break  # move to next model
                else:
                    raise  # non-quota error, bubble up
        # If we exhausted retries on this model, try the next one

    raise Exception(
        "All Gemini models are currently rate-limited on the free tier. "
        "Please wait a minute and try again, or add billing to your Google AI account at "
        "https://ai.google.dev to get higher quotas."
    )

def get_gemini_response(prompt, document_text):
    api_key = os.environ.get('GEMINI_API_KEY', '')
    if not api_key:
        return "Demo mode: Set GEMINI_API_KEY to enable real AI responses. Your question was: " + prompt[:100]

    full_prompt = f"""You are NeuraDocs, an intelligent document assistant.

Based on the following document content, answer the user's question accurately and helpfully.

DOCUMENT CONTENT:
{document_text[:8000]}

USER QUESTION: {prompt}

Provide a clear, concise, and helpful response based solely on the document content."""

    return call_gemini(full_prompt)

def get_summary(document_text, level):
    api_key = os.environ.get('GEMINI_API_KEY', '')

    level_instructions = {
        'concise': 'Provide a very brief 2-3 sentence summary capturing only the most essential points.',
        'standard': 'Provide a comprehensive paragraph summary covering the main topics, key points, and conclusions.',
        'detailed': 'Provide a thorough multi-paragraph summary covering all major sections, key arguments, important details, and conclusions in depth.'
    }
    instruction = level_instructions.get(level, level_instructions['standard'])

    if not api_key:
        word_count = len(document_text.split())
        return f"Demo summary ({level}): This document contains approximately {word_count} words. Set GEMINI_API_KEY environment variable to get real AI-generated summaries."

    prompt = f"""You are NeuraDocs. {instruction}

DOCUMENT CONTENT:
{document_text[:8000]}

Generate a {level} summary of this document:"""

    return call_gemini(prompt)

def create_pdf_response(content, filename, title):
    filepath = os.path.join(app.config['GENERATED_FOLDER'], filename)
    doc = SimpleDocTemplate(filepath, pagesize=letter,
                           rightMargin=inch, leftMargin=inch,
                           topMargin=inch, bottomMargin=inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Title'],
        fontSize=20,
        textColor=HexColor('#7c3aed'),
        spaceAfter=20
    )
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=11,
        leading=16,
        spaceAfter=10
    )
    label_style = ParagraphStyle(
        'Label',
        parent=styles['Normal'],
        fontSize=11,
        leading=16,
        textColor=HexColor('#7c3aed'),
        fontName='Helvetica-Bold'
    )
    
    story = [
        Paragraph("NeuraDocs", title_style),
        Paragraph(title, styles['Heading2']),
        Spacer(1, 0.2 * inch),
    ]
    
    # Handle chat format (list of dicts) vs plain string
    if isinstance(content, list):
        for msg in content:
            role = msg.get('role', '')
            text = msg.get('text', '')
            if role == 'user':
                story.append(Paragraph(f"You: {text}", label_style))
            else:
                story.append(Paragraph(f"AI: {text}", body_style))
            story.append(Spacer(1, 0.1 * inch))
    else:
        for line in content.split('\n'):
            if line.strip():
                story.append(Paragraph(line, body_style))
    
    doc.build(story)
    return filepath

# Auto-delete files after 10 minutes
def schedule_delete(filepath, delay=600):
    def delete_later():
        time.sleep(delay)
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except:
            pass
    threading.Thread(target=delete_later, daemon=True).start()

@app.route('/')
def index():
    if 'session_id' not in session:
        session['session_id'] = str(uuid.uuid4())
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Only PDF files are allowed'}), 400
    
    session_id = session.get('session_id', str(uuid.uuid4()))
    session['session_id'] = session_id
    
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
    file.save(filepath)
    
    # Extract text
    try:
        text = extract_text_from_pdf(filepath)
        document_store[session_id] = {
            'text': text,
            'filename': filename,
            'filepath': filepath
        }
        schedule_delete(filepath)
        return jsonify({'success': True, 'filename': filename, 'pages': len(text.split('\n'))})
    except Exception as e:
        return jsonify({'error': f'Failed to process PDF: {str(e)}'}), 500

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    question = data.get('question', '').strip()
    
    if not question:
        return jsonify({'error': 'No question provided'}), 400
    
    session_id = session.get('session_id')
    if not session_id or session_id not in document_store:
        return jsonify({'error': 'No document uploaded. Please upload a PDF first.'}), 400
    
    doc_text = document_store[session_id]['text']
    
    try:
        answer = get_gemini_response(question, doc_text)
        return jsonify({'answer': answer})
    except Exception as e:
        err = str(e)
        if '429' in err or 'RESOURCE_EXHAUSTED' in err or 'rate-limited' in err:
            return jsonify({'error': 'Quota limit reached. All free-tier Gemini models are exhausted. Please wait 1 minute and try again, or enable billing at https://ai.google.dev'}), 429
        return jsonify({'error': 'AI error: ' + err}), 500

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.get_json()
    level = data.get('level', 'standard')
    
    session_id = session.get('session_id')
    if not session_id or session_id not in document_store:
        return jsonify({'error': 'No document uploaded. Please upload a PDF first.'}), 400
    
    doc_text = document_store[session_id]['text']
    
    try:
        summary = get_summary(doc_text, level)
        return jsonify({'summary': summary})
    except Exception as e:
        err = str(e)
        if '429' in err or 'RESOURCE_EXHAUSTED' in err or 'rate-limited' in err:
            return jsonify({'error': 'Quota limit reached. All free-tier Gemini models are exhausted. Please wait 1 minute and try again, or enable billing at https://ai.google.dev'}), 429
        return jsonify({'error': 'AI error: ' + err}), 500

@app.route('/download-chat', methods=['POST'])
def download_chat():
    data = request.get_json()
    messages = data.get('messages', [])
    
    filename = f"chat_{uuid.uuid4().hex[:8]}.pdf"
    filepath = create_pdf_response(messages, filename, "Chat History")
    schedule_delete(filepath)
    
    return send_file(filepath, as_attachment=True, download_name='documind_chat.pdf')

@app.route('/download-summary', methods=['POST'])
def download_summary():
    data = request.get_json()
    summary = data.get('summary', '')
    level = data.get('level', 'standard')
    
    filename = f"summary_{uuid.uuid4().hex[:8]}.pdf"
    filepath = create_pdf_response(summary, filename, f"Document Summary ({level.capitalize()})")
    schedule_delete(filepath)
    
    return send_file(filepath, as_attachment=True, download_name='documind_summary.pdf')

@app.route('/download-voice', methods=['POST'])
def download_voice():
    data = request.get_json()
    messages = data.get('messages', [])
    
    filename = f"voice_{uuid.uuid4().hex[:8]}.pdf"
    filepath = create_pdf_response(messages, filename, "Voice Assistant Chat")
    schedule_delete(filepath)
    
    return send_file(filepath, as_attachment=True, download_name='documind_voice.pdf')

@app.route('/doc-info', methods=['GET'])
def doc_info():
    session_id = session.get('session_id')
    if session_id and session_id in document_store:
        return jsonify({
            'uploaded': True,
            'filename': document_store[session_id]['filename']
        })
    return jsonify({'uploaded': False})

os.makedirs('uploads', exist_ok=True)
os.makedirs('generated', exist_ok=True)

if __name__ == '__main__':
    app.run(debug=True, port=5000)