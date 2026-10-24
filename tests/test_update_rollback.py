"""Execute the real rollback function against a disposable Git repository."""
import subprocess
from pathlib import Path


def test_failed_upgrade_restores_original_commit(tmp_path):
    script = Path('scripts/update-release.sh').read_text()
    rollback = script[script.index('rollback(){'):script.index('trap rollback ERR')]
    def git(*args):
        return subprocess.check_output(['git', '-C', str(tmp_path), *args], text=True).strip()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    (tmp_path / 'version').write_text('old')
    git('add', '.')
    git('commit', '-m', 'old')
    old = git('rev-parse', 'HEAD')
    (tmp_path / 'version').write_text('new')
    git('commit', '-am', 'new')
    result = subprocess.run(['bash', '-c', '''
old="$1"; old_branch=main; backup=unused
say(){ :; }; docker(){ :; }; COMPOSE=(docker compose)
''' + rollback + '\nrollback', 'test', old], cwd=tmp_path)
    assert result.returncode == 1
    assert git('rev-parse', 'HEAD') == old
    assert (tmp_path / 'version').read_text() == 'old'
