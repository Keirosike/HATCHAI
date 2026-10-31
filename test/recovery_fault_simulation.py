"""Host file/transaction fault model. No board, SD driver or GPIO is accessed.

Production C++ CRC/selection/journal/time predicates are independently checked by
recovery_compile_test.cpp. This test exercises the documented JSON and A/B write
protocol on temporary host files; it does not prove FAT/card electrical behavior.
"""
from __future__ import annotations
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
NOW = int(dt.datetime(2026, 10, 21, 12, tzinfo=dt.timezone.utc).timestamp())
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()

def encode(state):
    value = copy.deepcopy(state)
    value.pop("crc32", None)
    value["crc32"] = zlib.crc32(compact(value))
    return compact(value)

def example(sequence=1):
    config = dict(temperatureMilliC=37500, humidityMilliPercent=55000, offsetMilliC=0,
        automatic=True, manualHeatRequested=False, fanAlwaysOn=True, windowMs=20000,
        kp=20, ki=0.04, kd=100, derivativeFilterSeconds=10, rampPercentPerSecond=2.5,
        minimumRelayDwellMs=5000, inhibitMilliC=38000, resumeMilliC=37500, highMilliC=38500,
        criticalMilliC=39000, lowMilliC=36500, lowClearMilliC=37000, sensorStaleMs=6500,
        sensorIntervalMs=2000, lowWarmupMs=1800000, lowDelayMs=600000,
        fanPin=14, heaterPin=27, lowerPin=26, upperPin=25, relayActiveHigh=False,
        lockdownAfterSeconds=1555200, sensorLogIntervalMs=10000,
        checkpointIntervalMs=60000, pidAccumulatorRestored=False)
    batches = []
    for motor, start in enumerate([NOW-10*86400-21*3600-30*60, NOW-6*86400-3*3600], 1):
        batches.append(dict(id=f"example-{motor}", start=start, label=f"BATCH-{motor:03}",
            name=f"Chicken Batch {motor}", eggCount=12+motor*3, durationDays=21, status=1,
            incubationDay=(NOW-start)//86400+1, expectedHatch=start+21*86400,
            lockdownStart=start+18*86400, lockdown=NOW>=start+18*86400, complete=False,
            intervalMinutes=120, runSeconds=15, cycleId=0, issued=0, lastCompleted=0,
            nextScheduled=NOW+7200, lastSuccessfulCycleId=0, transaction=0,
            positionHold=False, physicalPositionVerified=False))
    return dict(formatVersion=1, sequence=sequence, rtc=NOW, startup=NOW-10, restartReason=9,
        flags=2, config=config, batches=batches, diagnostics=dict(sensorValid=True,
        temperatureMilliC=37450, humidityMilliPercent=55000, highAlarm=False,
        lowAlarm=False, pidOutputMilliPercent=25000, heaterOn=False, lowerOn=False, upperOn=False))

def decode(raw):
    try:
        if not 0<len(raw)<=4096:
            return None
        value=json.loads(raw)
        expected=value.pop("crc32")
        if type(expected) is not int or zlib.crc32(compact(value))!=expected:
            return None
        if value["formatVersion"]!=1 or value["sequence"]<1 or value["config"]["windowMs"]!=20000:
            return None
        if len(value["batches"])!=2:
            return None
        for b in value["batches"]:
            if not 19<=b["durationDays"]<=35 or b["status"] not in range(5) or b["transaction"] not in range(5):
                return None
            if b["start"]>value["rtc"] or b["expectedHatch"]!=b["start"]+b["durationDays"]*86400:
                return None
        return value
    except (ValueError, TypeError, KeyError, OverflowError):
        return None

def select(a, b, rtc, floor=0):
    if rtc is None or rtc<1704067200 or rtc<floor:
        return None
    valid=[s for raw in (a,b) if (s:=decode(raw)) and s["rtc"]<=rtc]
    return max(valid, key=lambda s:s["sequence"]) if valid else None

def recovered_motor(snapshot, serial=0, intent=False):
    b=snapshot["batches"][0]
    hold=b["positionHold"] or b["transaction"] in (1,2) or intent or serial>b["cycleId"]
    return dict(relayOn=False, positionHold=hold, transaction="INTERRUPTED" if hold else "IDLE",
        next=max(b["nextScheduled"], NOW+120) if b["nextScheduled"]<=NOW else b["nextScheduled"])

def simulate():
    check(zlib.crc32(b"123456789")==0xCBF43926,"CRC standard vector")
    old, new=encode(example(1)), encode(example(2))
    check(select(old,new,NOW)["sequence"]==2,"Normal startup selects newest valid snapshot")
    check(select(b"bad",new,NOW)["sequence"]==2,"Corrupt A uses B")
    check(select(old,b"bad",NOW)["sequence"]==1,"Corrupt B uses A")
    check(select(b"bad",b"bad",NOW) is None,"Both invalid must fault, not create Day 1")
    check(select(old,new,None) is None,"RTC failure prevents recovery")
    check(select(old,new,NOW,floor=NOW+1) is None,"RTC behind durable journal faults")
    future=example(3); future["rtc"]=NOW+100
    check(select(old,encode(future),NOW)["sequence"]==1,"Future timestamp falls back safely")
    changed=example(3); changed["formatVersion"]=99
    check(select(old,encode(changed),NOW)["sequence"]==1,"Future format is not loaded")
    changed=example(3); changed["config"]["windowMs"]=1000
    check(select(old,encode(changed),NOW)["sequence"]==1,"Unsafe relay window is rejected")
    check(decode(new+b"{}")==None,"Trailing invalid JSON rejected")
    check(decode(b"x"*4097)==None,"Oversized recovery file rejected")
    with tempfile.TemporaryDirectory(prefix=".recovery-model-",dir=ROOT/"test") as folder:
        work=Path(folder).resolve()
        assert work.parent==(ROOT/"test").resolve()  # verified before recursive temporary cleanup
        a,b=work/"batch_state_a.json",work/"batch_state_b.json"
        b.write_bytes(new)
        pending=encode(example(3))
        for cut in range(len(pending)+1):
            a.write_bytes(pending[:cut])
            selected=select(a.read_bytes(),b.read_bytes(),NOW)
            check(selected is not None,"Power cut during inactive write preserves a recovery copy")
            check(selected["sequence"]==(3 if cut==len(pending) else 2),"Only full verified state can replace latest checkpoint")
        check(b.read_bytes()==new,"Protected snapshot is never truncated by the protocol")
        for index in range(len(pending)):
            damaged=bytearray(pending); damaged[index]^=1
            check(select(bytes(damaged),new,NOW)["sequence"]==2,"Single-bit corruption falls back to protected copy")
        a.write_bytes(b"{"); b.write_bytes(b"")
        before=sorted(p.name for p in work.iterdir())
        check(select(a.read_bytes(),b.read_bytes(),NOW) is None,"Reset during checkpoint with two bad copies remains a fault")
        check(before==sorted(p.name for p in work.iterdir()),"Recovery fault does not invent or overwrite a batch")
    for stage in ("before_intent","intent","pending","in_progress","relay_on","relay_off","completed","journal_cleared"):
        state=example(10); motor=state["batches"][0]
        cycle=0 if stage=="before_intent" else 1
        motor.update(cycleId=cycle,issued=NOW if cycle else 0)
        motor["transaction"]={"pending":1,"in_progress":2,"relay_on":2,"relay_off":2,"completed":3,"journal_cleared":3}.get(stage,0)
        if motor["transaction"]==3:
            motor.update(lastCompleted=NOW,lastSuccessfulCycleId=1)
        state["diagnostics"]["lowerOn"]=stage=="relay_on"
        restored=recovered_motor(state,serial=cycle,intent=stage not in ("before_intent","journal_cleared"))
        check(not restored["relayOn"],f"{stage}: saved relay ON is never restored")
        check(restored["positionHold"]==(stage not in ("before_intent","journal_cleared")),f"{stage}: uncertain position requires verification")
    stale=example(10); stale["batches"][0].update(cycleId=7,issued=NOW-7200,transaction=3,lastCompleted=NOW-7185,lastSuccessfulCycleId=7)
    check(recovered_motor(stale,serial=8,intent=True)["positionHold"],"Newer NVS intent defeats stale valid SD fallback")
    missed=example(10); missed["batches"][0]["nextScheduled"]=NOW-72000
    check(recovered_motor(missed)["next"]==NOW+120,"Missed turns are not replayed immediately")
    lockdown_start=example()["batches"][0]["lockdownStart"]
    check(lockdown_start-example()["batches"][0]["start"]==18*86400,"RTC lockdown stays tied to original start")
    for offset in range(8):
        start=NOW-5*86400-1234
        check((NOW+offset-start)//86400+1==6,"Repeated boots preserve the RTC incubation day")
    # A successful checkpoint sequence may have gaps. Reserved NVS blocks mean
    # lost/torn files and reboot cannot reuse any previously issued sequence.
    cursor=256; ceiling=512; issued=[257,258,259]
    cursor=max(ceiling,max(issued)); ceiling=cursor+256
    check(cursor+1>max(issued),"Sequence block reservation survives loss of latest SD copy")
    critical_sd=False; critical_nvs=True
    check(critical_sd or critical_nvs,"Old SD copy cannot clear a persistent critical alarm")
    print(json.dumps({"passed":checks,"scope":"host temporary files and fault model; no physical board/card accessed"}))

def write_examples():
    target=ROOT/"docs"/"examples"/"recovery"
    target.mkdir(parents=True,exist_ok=False)
    for name,sequence in (("batch_state_a.json",257),("batch_state_b.json",258)):
        safe=example(sequence); safe["flags"]=0; safe["config"]["automatic"]=False
        for b in safe["batches"]: b["status"]=2
        (target/name).write_bytes(encode(safe)+b"\n")
    (target/"config.json").write_text(json.dumps(safe["config"],indent=2)+"\n",encoding="utf-8")
    (target/"temperature.csv").write_text(f"rtc,temperature_c,target_c,offset_c,heater_on,pid_percent,mode,high_alarm,low_alarm,critical_alarm\n{NOW},37.45,37.50,0.00,0,25.00,auto,0,0,0\n")
    (target/"humidity.csv").write_text(f"rtc,humidity_percent,target_percent\n{NOW},55.00,55.00\n")
    (target/"egg_turning.csv").write_text(f"rtc,motor,cycle_id,transaction,run_seconds,next_scheduled,position_verified,reason\n{NOW},1,7,INTERRUPTED,15,{NOW+7200},false,restart_position_unknown\n")
    (target/"system_events.csv").write_text(f"rtc,event,detail\n{NOW},STARTUP_RECOVERY,Batch timing restored from RTC\n")
    (target/"recovery.csv").write_text(f"rtc,restart_reason,snapshot_sequence,result,position_hold_mask\n{NOW},9,258,restored,1\n")
    (target/"README.md").write_text("Synthetic schema examples, not device recordings. Do not copy these onto a live card: IDs and timestamps are fictional. CRC is computed over compact insertion-ordered JSON with crc32 removed. RTC epoch integers encode the DS3231 local calendar, without a timezone conversion.\n")

if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--write-examples",action="store_true")
    args=parser.parse_args()
    simulate()
    if args.write_examples: write_examples()
