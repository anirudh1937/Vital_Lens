p.write_text('''services:\n  api:\n    build: ../backend\n    ports:\n      - \"8000:8000\"\n    env_file:\n      - ../backend/.env\n''')
