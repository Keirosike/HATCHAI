"""Build only: isolated ESP-IDF 5.4.4; no serial, flashing or production changes."""
from pathlib import Path
import os, subprocess, sys, shutil
root=Path(__file__).resolve().parents[1]
work=root/'dist/camera-tools';sdk=work/'esp-idf';tools=work/'espressif'
env=os.environ.copy();env.update(IDF_PATH=str(sdk),IDF_TOOLS_PATH=str(tools),CMAKE_BUILD_PARALLEL_LEVEL='2')
python=tools/'python_env/idf5.4_py3.11_env/Scripts/python.exe'
if not python.exists():raise SystemExit('Install the isolated ESP-IDF 5.4 Python 3.11 environment first')
exports=subprocess.check_output([str(python),str(sdk/'tools/idf_tools.py'),'export','--format','key-value'],env=env,text=True)
for line in exports.splitlines():
    if '=' in line:
        key,value=line.split('=',1)
        env[key]=value.replace('%PATH%',env.get('PATH','')) if key=='PATH' else value
config=work/'sdkconfig'
if not config.exists():shutil.copy2(root/'esp32-devcam/camera/sdkconfig',config)
command=[str(python),str(sdk/'tools/idf.py'),'-C',str(root/'esp32-devcam/camera'),'-B',str(work/'build-camera'),'-D','SDKCONFIG='+str(config),'-D','IDF_TARGET=esp32s3','reconfigure']
if '--build-only' not in sys.argv:
    configured=subprocess.call(command,env=env,cwd=root)
    if configured:raise SystemExit(configured)
cmake=shutil.which('cmake',path=env['PATH'])
if not cmake:raise SystemExit('Pinned CMake is not installed')
raise SystemExit(subprocess.call([cmake,'--build',str(work/'build-camera'),'--parallel','2'],env=env,cwd=root))
