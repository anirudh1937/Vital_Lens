from pathlib import Path  
text=Path('README.md').read_text()  
pos=text.find('ECHO')  
print(repr(text[pos-10:pos+20]))  
print(text[pos:pos+20])  
