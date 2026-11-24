import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--jar', required=True)
parser.add_argument('--real-agent', action='store_true')
parser.add_argument('--whole-project', action='store_true')
parser.add_argument('--verify-deletion', action='store_true')
parser.add_argument('--verify-frame', action='store_true')
parser.add_argument('--verify-chat', action='store_true')
parser.add_argument('--verify-jobs', action='store_true')
parser.add_argument('--verify-legacy', action='store_true')
parser.add_argument('--verify-shots', action='store_true')
parser.add_argument('--verify-data-lease', action='store_true')
parser.add_argument('--verify-history', action='store_true')
parser.add_argument('--verify-upload', action='store_true')
parser.add_argument('--verify-import', action='store_true')
parser.add_argument('--root-source', action='store_true')
parser.add_argument('--port', type=int, default=18084)
parser.add_argument('--output')
options = parser.parse_args()
if options.whole_project and not options.real_agent:
    parser.error('--whole-project requires --real-agent')
if options.verify_chat and not options.real_agent:
    parser.error('--verify-chat requires --real-agent')
if options.verify_legacy and not options.real_agent:
    parser.error('--verify-legacy requires --real-agent')
repo = pathlib.Path(__file__).resolve().parents[4]
output = pathlib.Path(options.output or tempfile.mkdtemp(prefix='fm-workbench-acceptance-')).resolve()
output.mkdir(parents=True, exist_ok=True)
environment = dict(os.environ)
config = pathlib.Path.home() / '.config/FengMotion/env'
if config.exists():
    for line in config.read_text().splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
        if match:
            name, value = match.groups()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ['"', "'"]:
                value = value[1:-1]
            environment.setdefault(name, value)
environment['PATH'] = str(pathlib.Path.home() / '.local/bin') + os.pathsep + environment.get('PATH', '')
chrome = environment.get('FENGMOTION_CHROME')
if not chrome:
    installed = list((pathlib.Path.home() / '.cache/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
    if installed:
        chrome = str(sorted(installed)[-1])
if not chrome or not pathlib.Path(chrome).is_file():
    raise RuntimeError('Set FENGMOTION_CHROME to an installed headless Chromium; this test does not download a browser')
java = str(pathlib.Path(os.environ.get('JAVA_HOME', '/usr/lib/jvm/java-21-openjdk')) / 'bin/java')
command = [java, '-jar', str(pathlib.Path(options.jar).resolve()),
           '--server.port=' + str(options.port), '--fengmotion.data-dir=' + str(output / 'data'),
           '--fengmotion.workspace-root=' + str(output / 'projects'), '--fengmotion.retrieval.enabled=false',
           '--fengmotion.live-preview.project-dir=' + str(repo / 'frontend/live-preview'),
           '--fengmotion.remotion.project-dir=' + str(repo / 'backend/remotion'),
           '--fengmotion.remotion.node-modules=' + str(repo / 'frontend/node_modules'),
           '--fengmotion.remotion.browser=' + chrome,
           '--fengmotion.harness.enabled=' + str(options.real_agent).lower(),
           '--fengmotion.workflow.dir=' + str(repo / 'frontend/workflow-v0.1.1'),
           '--fengmotion.workflow.agent-timeout-seconds=120']
dsh = shutil.which('dsh', path=environment['PATH'])
if dsh:
    command.append('--fengmotion.harness.bin=' + dsh)
base = 'http://127.0.0.1:' + str(options.port) + '/api'
upload_session = None
def upload_call(method, route, payload=None, headers=None):
    if isinstance(payload, dict):
        payload = json.dumps(payload).encode()
        headers = {'Content-Type': 'application/json', **(headers or {})}
    request = urllib.request.Request(base + route, data=payload, headers=headers or {}, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
        return json.loads(data) if data else None
with (output / 'server.log').open('w') as log:
    server = subprocess.Popen(command, cwd=output, env=environment, stdout=log, stderr=log)
    try:
        for attempt in range(200):
            if server.poll() is not None:
                raise RuntimeError('Isolated backend exited; inspect ' + str(output / 'server.log'))
            try:
                with urllib.request.urlopen(base + '/health', timeout=2) as response:
                    if response.status == 200:
                        break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.1)
        else:
            raise RuntimeError('Isolated backend did not become ready')
        environment['FENGMOTION_ACCEPTANCE_API'] = base
        if options.verify_upload:
            upload_session = upload_call('POST', '/assets/uploads', {'fileName': 'restart.txt', 'mimeType': 'text/plain', 'sizeBytes': 3})
            upload_call('PUT', '/assets/uploads/' + upload_session['uploadId'] + '/chunks/0', b'abc',
                        {'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-2/3'})
        if options.verify_data_lease:
            duplicate_command = [argument if not argument.startswith('--server.port=') else '--server.port=' + str(options.port + 1) for argument in command]
            with (output / 'duplicate-server.log').open('w') as duplicate_log:
                duplicate = subprocess.Popen(duplicate_command, cwd=output, env=environment, stdout=duplicate_log, stderr=duplicate_log)
                try:
                    code = duplicate.wait(timeout=20)
                    if code == 0 or '同一数据库已有后端占用' not in (output / 'duplicate-server.log').read_text():
                        raise RuntimeError('Second backend did not reject the shared database')
                finally:
                    if duplicate.poll() is None:
                        duplicate.kill()
                        duplicate.wait(timeout=5)
            print(json.dumps({'dataLeaseVerified': True}), flush=True)
        environment['FENGMOTION_ACCEPTANCE_REPORT'] = str(output / 'result.json')
        print(json.dumps({'stage': 'ready', 'output': str(output), 'realAgent': options.real_agent}), flush=True)
        arguments = ['node', str(pathlib.Path(__file__).with_name('acceptance.mjs'))]
        if options.real_agent:
            arguments.append('--real-agent')
        if options.whole_project:
            arguments.append('--whole-project')
        if options.verify_deletion:
            arguments.append('--verify-deletion')
        if options.verify_frame:
            arguments.append('--verify-frame')
        if options.verify_chat:
            arguments.append('--verify-chat')
        if options.verify_jobs:
            arguments.append('--verify-jobs')
        if options.verify_legacy:
            arguments.append('--verify-legacy')
        if options.verify_shots:
            arguments.append('--verify-shots')
        if options.verify_history:
            arguments.append('--verify-history')
        if options.verify_import:
            arguments.append('--verify-import')
        if options.root_source:
            arguments.append('--root-source')
        result = subprocess.run(arguments, cwd=repo, env=environment, timeout=360)
        if result.returncode:
            raise RuntimeError('Acceptance failed; inspect ' + str(output))
    finally:
        server.terminate()
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
if options.verify_data_lease or options.verify_upload:
    with (output / 'restart-server.log').open('w') as restart_log:
        restarted = subprocess.Popen(command, cwd=output, env=environment, stdout=restart_log, stderr=restart_log)
        try:
            for attempt in range(200):
                if restarted.poll() is not None:
                    raise RuntimeError('Backend failed to restart after releasing database lease')
                try:
                    with urllib.request.urlopen(base + '/health', timeout=2) as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(.1)
            else:
                raise RuntimeError('Restarted backend did not become healthy')
            print(json.dumps({'dataLeaseRestartVerified': True}), flush=True)
            if options.verify_upload:
                upload_id = upload_session['uploadId']
                state = upload_call('GET', '/assets/uploads/' + upload_id)
                if state['receivedBytes'] != 3:
                    raise RuntimeError('Upload progress was lost across restart')
                first = upload_call('POST', '/assets/uploads/' + upload_id + '/complete')
                second = upload_call('POST', '/assets/uploads/' + upload_id + '/complete')
                if first['asset']['id'] != second['asset']['id']:
                    raise RuntimeError('Repeated upload completion duplicated the asset')
                print(json.dumps({'uploadRestartVerified': True, 'uploadCompletionReplayVerified': True}), flush=True)
        finally:
            restarted.terminate()
            try:
                restarted.wait(timeout=15)
            except subprocess.TimeoutExpired:
                restarted.kill()
                restarted.wait(timeout=5)
