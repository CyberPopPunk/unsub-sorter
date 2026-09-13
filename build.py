import zipfile

files = [
    'manifest.json',
    'background.js',
    'README.md',
    'LICENSE',
    'popup/popup.html',
    'popup/popup.css',
    'popup/core.js',
    'popup/popup.js',
    'icons/icon32.png',
    'icons/icon64.png',
    'icons/icon128.png'
]

with zipfile.ZipFile('unread-sender-sorter.xpi', 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        zf.write(f, arcname=f.replace('\\', '/'))

print('Successfully built unread-sender-sorter.xpi with POSIX paths.')
