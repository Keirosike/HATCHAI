// Compile-only tests: the compiler evaluates the production timing predicates.
// No board or relay access. Use -std=c++11 -Iinclude -fsyntax-only on this file.
#include "TurnCycle.h"
#include "Config.h"

constexpr uint32_t Interval = HatchConfig::DefaultTurnIntervalMinutes * 60000UL;
constexpr uint32_t Pulse = HatchConfig::TurnerPulseMs;
static_assert(Interval == 7200000UL && Pulse == 120000UL, "Requested timing defaults");
static_assert(HatchConfig::FanRelayPin == 14 && HatchConfig::Bulb1RelayPin == 27 &&
              HatchConfig::TurnerRelayPin == 25 && HatchConfig::Turner2RelayPin == 26,
              "Requested IN1-IN4 mapping");
static_assert(!HatchConfig::RelayActiveHigh, "Preserve active-low relay polarity");
constexpr uint32_t Boot = 1000;
constexpr TurnCycle Idle;
static_assert(!Idle.isDue(Boot, Boot, Interval), "No turn at boot");
static_assert(!Idle.isDue(Boot + Interval - 1, Boot, Interval), "Wait full interval");
static_assert(Idle.isDue(Boot + Interval, Boot, Interval), "Turn at two hours");

constexpr TurnCycle Motor1(true, true, 8000000, 8000000);
constexpr TurnCycle Motor2(true, true, 8007000, 8007000);
static_assert(!Motor1.pulseExpired(8119999, Pulse), "Keep running before 120s");
static_assert(Motor1.pulseExpired(8120000, Pulse), "Stop exactly at 120s");
static_assert(!Motor2.pulseExpired(8120000, Pulse), "Second motor keeps its own timer");
static_assert(!Motor1.isDue(8000000 + Interval, Boot, Interval), "No overlapping pulse");

constexpr TurnCycle Finished(true, false, 8000000, 8000000);
static_assert(!Finished.pulseExpired(8090000, Pulse), "Inactive pulse cannot finish twice");
static_assert(!Finished.isDue(8000000 + Interval - 1, Boot, Interval), "Schedule from last start");
static_assert(Finished.isDue(8000000 + Interval, Boot, Interval), "Next turn at interval");
static_assert(Finished.isDue(8000000 + 3600000, Boot, 3600000), "Independent interval override");

constexpr uint32_t WrapStart = UINT32_MAX - 1000;
constexpr TurnCycle Wrapped(true, true, WrapStart, WrapStart);
static_assert(!Wrapped.pulseExpired(uint32_t(WrapStart + Pulse - 1), Pulse), "Rollover before stop");
static_assert(Wrapped.pulseExpired(uint32_t(WrapStart + Pulse), Pulse), "Rollover stop");
constexpr TurnCycle WrappedIdle(true, false, WrapStart, WrapStart);
static_assert(WrappedIdle.isDue(uint32_t(WrapStart + Interval), 0, Interval), "Rollover schedule");
static_assert(Idle.isDue(uint32_t(WrapStart + Interval), WrapStart, Interval), "Boot across rollover");
constexpr TurnCycle ZeroDeadline(true, true, uint32_t(0UL - Pulse), uint32_t(0UL - Pulse));
static_assert(ZeroDeadline.pulseExpired(0, Pulse), "Zero deadline is a valid completion");

constexpr TurnCycle ShortManual(true, true, 1000, 1000, 7000);
constexpr TurnCycle LongManual(true, true, 1000, 1000, 17000);
static_assert(ShortManual.pulseRemainingMs(1000) == 7000, "Selected manual duration");
static_assert(ShortManual.pulseRemainingMs(7999) == 1, "Run until the requested boundary");
static_assert(ShortManual.pulseRemainingMs(8000) == 0, "Stop at seven seconds");
static_assert(LongManual.pulseRemainingMs(8000) == 10000, "Motor durations are independent");
static_assert(LongManual.pulseRemainingMs(18000) == 0, "Second motor has its own deadline");
static_assert(LongManual.pulseRemainingMs(19000) == 0, "An overdue timer must not underflow");
constexpr TurnCycle WrappedManual(true, true, WrapStart, WrapStart, 7000);
static_assert(WrappedManual.pulseRemainingMs(uint32_t(WrapStart + 6999)) == 1, "Custom duration across rollover");
static_assert(WrappedManual.pulseRemainingMs(uint32_t(WrapStart + 7000)) == 0, "Custom duration rollover completion");
static_assert(Idle.pulseRemainingMs(1000) == 0, "Inactive motor has no remaining time");
static_assert(HatchConfig::MinManualTurnSeconds == 1 && HatchConfig::MaxManualTurnSeconds == 600,
              "Manual duration bounds");

static_assert(HatchConfig::legacyRollerPins(26,25), "Earlier checkpoint pin layout is recognized");
static_assert(HatchConfig::currentRollerPins(25,26), "Corrected physical layout is recognized");
static_assert(!HatchConfig::legacyRollerPins(25,25) && !HatchConfig::currentRollerPins(26,26), "Duplicate relay pins stay invalid");

constexpr TurnCycle LowerOverlap(true,true,1000,1000,120000);
constexpr TurnCycle UpperOverlap(true,true,31000,31000,120000);
static_assert(LowerOverlap.pulseExpired(121000,120000) && UpperOverlap.pulseRemainingMs(121000)==30000,
  "Lower deadline does not shorten upper's independently started 120-second run");
static_assert(UpperOverlap.pulseRemainingMs(151000)==0,"Upper keeps its own exact deadline");
