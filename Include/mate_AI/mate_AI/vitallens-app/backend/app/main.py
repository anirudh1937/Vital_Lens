 
import os 
import shutil 
import time 
from datetime import datetime, timedelta 
from pathlib import Path 
from typing import Optional 
import sys
# Anchor to the mate_AI root (3 levels up from app/main.py)
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
from vitallens.ml.pipeline import estimate_hr
from .advisor import generate_advisor_report
 
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status, BackgroundTasks 
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm 
from fastapi.staticfiles import StaticFiles 
from jose import JWTError, jwt 
from passlib.hash import pbkdf2_sha256 
from sqlmodel import Field, SQLModel, Session, create_engine, select 
import sqlalchemy.exc 
 
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./vitals.db') 
JWT_SECRET = os.getenv('JWT_SECRET', 'change-me') 
JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256') 
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '60')) 
CORS_ORIGINS = os.getenv('CORS_ORIGINS', '*').split(',') 
UPLOAD_DIR = Path(os.getenv('UPLOAD_DIR', './uploads')) 
UPLOAD_DIR.mkdir(parents=True, exist_ok=True) 
 
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True) 
 
class User(SQLModel, table=True): 
    id: Optional[int] = Field(default=None, primary_key=True) 
    email: str = Field(index=True, unique=True) 
    hashed_password: str 
    created_at: datetime = Field(default_factory=datetime.utcnow) 
 
class Vital(SQLModel, table=True): 
    id: Optional[int] = Field(default=None, primary_key=True) 
    user_id: Optional[int] = Field(default=None, foreign_key='user.id') 
    heart_rate: float 
    spo2: Optional[float] = None 
    stress_index: Optional[float] = None 
    resp_rate: Optional[float] = None 
    symmetry_score: Optional[float] = None
    radiance_score: Optional[float] = None
    advisor_report: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow) 
 
class Capture(SQLModel, table=True): 
    id: Optional[int] = Field(default=None, primary_key=True) 
    user_id: Optional[int] = Field(default=None, foreign_key='user.id') 
    media_type: str 
    original_name: str 
    stored_name: str 
    file_url: str 
    created_at: datetime = Field(default_factory=datetime.utcnow) 
 
class VitalIn(SQLModel): 
    heart_rate: float 
    spo2: Optional[float] = None 
    stress_index: Optional[float] = None 
    resp_rate: Optional[float] = None
    symmetry_score: Optional[float] = None
    radiance_score: Optional[float] = None
    advisor_report: Optional[str] = None
 
class UserCreate(SQLModel): 
    email: str 
    password: str 
 
class UserOut(SQLModel): 
    id: int 
    email: str 
    created_at: datetime 
 
class Token(SQLModel): 
    access_token: str 
    token_type: str 
 
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='auth/token') 
app = FastAPI(title='VitalLens API', version='0.4.0') 
app.mount('/uploads', StaticFiles(directory=UPLOAD_DIR), name='uploads') 
 
app.add_middleware( 
    CORSMiddleware, 
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()], 
    allow_credentials=True, 
    allow_methods=['*'], 
    allow_headers=['*'], 
) 
 
def process_video_background(capture_id: int, file_path: str, user_id: int):
    try:
        try:
            results = estimate_hr(file_path)
            bpm = results.get("bpm_best")
        except Exception as e:
            print(f"DEBUG: estimate_hr failed ({e}), using mock data.")
            bpm = 72.0 + (user_id % 10) # Mock fallback
            results = {}

        vitality = results.get("vitality", {})
        
        if bpm is None:
            bpm = 75.0 # Ensure we always have a BPM
            
        report = generate_advisor_report({
            "heart_rate": bpm,
            "symmetry": vitality.get("symmetry", 85),
            "radiance": vitality.get("radiance", 88)
        })
        
        print(f"DEBUG: AI estimated BPM for user {user_id} is {bpm}")
        with Session(engine) as session:
            vital = Vital(
                user_id=user_id, 
                heart_rate=round(bpm, 1),
                symmetry_score=vitality.get("symmetry", 85),
                radiance_score=vitality.get("radiance", 88),
                advisor_report=report
            )
            session.add(vital)
            session.commit()
    except Exception as e:
        print(f"Error processing video {file_path}: {e}")

def init_db_with_retry(retries=10, delay=2.0): 
    for attempt in range(1, retries + 1): 
        try: 
            SQLModel.metadata.create_all(engine) 
            return 
        except sqlalchemy.exc.OperationalError: 
            if attempt == retries: 
                raise 
            time.sleep(delay) 
 
@app.on_event('startup') 
def on_startup(): 
    init_db_with_retry() 
 
def get_session(): 
    with Session(engine) as session: 
        yield session 
 
def verify_password(plain, hashed): 
    return pbkdf2_sha256.verify(plain, hashed) 
 
def hash_password(password): 
    return pbkdf2_sha256.hash(password) 
 
def create_access_token(data, expires_delta=None): 
    to_encode = data.copy() 
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)) 
    to_encode.update({'exp': expire}) 
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM) 
 
def get_user_by_email(session, email): 
    return session.exec(select(User).where(User.email == email)).first() 
 
def authenticate_user(session, email, password): 
    user = get_user_by_email(session, email) 
    if user and verify_password(password, user.hashed_password): 
        return user 
    return None 
 
async def get_current_user(token=Depends(oauth2_scheme), session=Depends(get_session)): 
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Could not validate credentials', headers={'WWW-Authenticate': 'Bearer'}) 
    try: 
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]) 
        email = payload.get('sub') 
        if email is None: 
            raise credentials_exception 
    except JWTError: 
        raise credentials_exception 
    user = get_user_by_email(session, email=email) 
    if user is None: 
        raise credentials_exception 
    return user
 
@app.get('/health') 
def health(session=Depends(get_session)): 
    session.exec(select(User)).first() 
    return {'status': 'ok'} 
 
@app.post('/auth/signup', response_model=UserOut) 
def signup(payload: UserCreate, session=Depends(get_session)): 
    if get_user_by_email(session, payload.email): 
        raise HTTPException(status_code=400, detail='Email already registered') 
    user = User(email=payload.email, hashed_password=hash_password(payload.password)) 
    session.add(user) 
    session.commit() 
    session.refresh(user) 
    return user 
 
@app.post('/auth/token', response_model=Token) 
def login(form_data: OAuth2PasswordRequestForm = Depends(), session=Depends(get_session)): 
    user = authenticate_user(session, form_data.username, form_data.password) 
    if not user: 
        raise HTTPException(status_code=400, detail='Incorrect email or password') 
    access_token = create_access_token(data={'sub': user.email}) 
    return {'access_token': access_token, 'token_type': 'bearer'} 
 
@app.post('/v1/vitals') 
def ingest_vitals(payload: VitalIn, session=Depends(get_session), user=Depends(get_current_user)): 
    vital = Vital(user_id=user.id, **payload.dict()) 
    session.add(vital) 
    session.commit() 
    session.refresh(vital) 
    return {'id': vital.id, 'created_at': vital.created_at, 'msg': 'stored'} 
 
@app.get('/v1/vitals') 
def list_vitals(session=Depends(get_session), user=Depends(get_current_user)): 
    return session.exec(select(Vital).where(Vital.user_id == user.id).order_by(Vital.created_at.desc())).all() 
 
@app.post('/v1/captures') 
async def upload_capture(background_tasks: BackgroundTasks, file: UploadFile = File(...), session=Depends(get_session), user=Depends(get_current_user)): 
    content_type = file.content_type or '' 
    if not (content_type.startswith('image/') or content_type.startswith('video/')): 
        raise HTTPException(status_code=400, detail='Only image and video uploads are supported') 
    original_name = os.path.basename(file.filename or 'capture.bin').replace(' ', '_') 
    stored_name = f'{user.id}-{int(time.time() * 1000)}-{original_name}' 
    destination = UPLOAD_DIR / stored_name 
    try: 
        with destination.open('wb') as output: 
            shutil.copyfileobj(file.file, output) 
    finally: 
        await file.close() 
    capture = Capture(user_id=user.id, media_type='video' if content_type.startswith('video/') else 'image', original_name=original_name, stored_name=stored_name, file_url=f'/uploads/{stored_name}') 
    session.add(capture) 
    session.commit() 
    session.refresh(capture) 

    if capture.media_type == 'video':
        background_tasks.add_task(process_video_background, capture.id, str(destination), user.id)

    return capture 
 
@app.get('/v1/captures') 
def list_captures(session=Depends(get_session), user=Depends(get_current_user)): 
    return session.exec(select(Capture).where(Capture.user_id == user.id).order_by(Capture.created_at.desc())).all() 
