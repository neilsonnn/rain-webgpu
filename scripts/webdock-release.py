"""Run over SSH to stage, publish, or roll back a static-site release."""
import json
import os
from pathlib import Path
import re
import sys


def replace_link(link: Path, target: str) -> None:
    if link.exists() and not link.is_symlink():
        raise ValueError(f'Refusing to replace a non-symlink: {link}')
    temporary = link.with_name(link.name + '.next')
    if temporary.is_symlink():
        temporary.unlink()
    elif temporary.exists():
        raise ValueError(f'Refusing to replace a non-symlink: {temporary}')
    temporary.symlink_to(target)
    os.replace(temporary, link)


def operate(root: Path, action: str, release: str) -> dict:
    if not root.is_absolute() or root == Path('/') or '..' in root.parts:
        raise ValueError('Deployment root must be a specific absolute directory')
    if not re.fullmatch(r'[a-f0-9]{40}-[0-9]+-[0-9]+', release):
        raise ValueError('Invalid release ID')
    directory = root / 'releases' / release
    current = root / 'current'
    rollback = root / f'.rollback-{release}.json'
    if action == 'stage':
        directory.mkdir(parents=True, exist_ok=False)
    elif action == 'publish':
        if not (directory / 'index.html').is_file() or not (directory / 'assets').is_dir():
            raise ValueError('Release is missing its built index or assets')
        manifest = json.loads((directory / '_deployment.json').read_text())
        if manifest.get('release') != release or manifest.get('commit') != release.split('-')[0]:
            raise ValueError('Deployment manifest does not match this release')
        if current.exists() and not current.is_symlink():
            raise ValueError('Refusing to replace an existing current directory or file')
        previous = os.readlink(current) if current.is_symlink() else None
        rollback.write_text(json.dumps({'previous': previous}))
        if previous is not None:
            replace_link(root / 'previous', previous)
        replace_link(current, str(directory))
    elif action == 'rollback':
        if not current.is_symlink() or os.readlink(current) != str(directory):
            raise ValueError('The live release changed; refusing to overwrite it during rollback')
        previous = json.loads(rollback.read_text())['previous']
        if previous is None:
            current.unlink()
        else:
            replace_link(current, previous)
    else:
        raise ValueError('Unknown action')
    return {'action': action, 'release': release, 'directory': str(directory)}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('Expected deployment root, action, and release ID')
        print(json.dumps(operate(Path(sys.argv[1]), sys.argv[2], sys.argv[3])))
    except (ValueError, OSError, KeyError) as error:
        print(f'Deployment failed: {error}', file=sys.stderr)
        sys.exit(1)
