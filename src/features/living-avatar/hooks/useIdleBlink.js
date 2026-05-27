// ============================================================
// useIdleBlink — probabilistic blink scheduler
// ============================================================
// v55.83-A.6.27.72 HOTFIX 18.
//
// Schedules natural-looking blinks while the avatar is NOT speaking.
// Real human blink rate is roughly every 4 seconds with random jitter.
// We use a probabilistic schedule: every ~3-5 seconds attempt a blink,
// with small chance of a double-blink (5%). When blinking, the consumer
// receives `true` for ~120ms then `false`.
//
// CLEANUP: clears the timeout on unmount or when paused=true (speaking).
// ============================================================

import { useEffect, useRef } from 'react';

/**
 * @param {Object} params
 * @param {boolean} params.paused          — true while speaking (no blinks while talking)
 * @param {(blinking: boolean) => void} params.onBlink
 * @param {number} [params.baseIntervalMs] — average interval; default 4000
 * @returns {void}
 */
export function useIdleBlink(params) {
  var paused = params.paused;
  var baseInterval = params.baseIntervalMs || 4000;
  var onBlinkRef = useRef(params.onBlink);
  useEffect(function () { onBlinkRef.current = params.onBlink; }, [params.onBlink]);

  useEffect(function () {
    if (paused) {
      if (onBlinkRef.current) onBlinkRef.current(false);
      return;
    }
    var alive = true;
    var timer = null;

    function scheduleNext() {
      if (!alive) return;
      // Jitter the next blink so cadence doesn't feel robotic.
      // Range: [base * 0.75, base * 1.5].
      var jitter = baseInterval * (0.75 + Math.random() * 0.75);
      timer = setTimeout(function () {
        if (!alive) return;
        doBlink(function () {
          if (!alive) return;
          // 5% chance of an immediate second blink (natural human behavior).
          if (Math.random() < 0.05) {
            setTimeout(function () {
              if (!alive) return;
              doBlink(scheduleNext);
            }, 180);
          } else {
            scheduleNext();
          }
        });
      }, jitter);
    }

    function doBlink(after) {
      if (onBlinkRef.current) onBlinkRef.current(true);
      setTimeout(function () {
        if (!alive) return;
        if (onBlinkRef.current) onBlinkRef.current(false);
        if (after) after();
      }, 120);
    }

    scheduleNext();

    return function () {
      alive = false;
      if (timer) clearTimeout(timer);
      if (onBlinkRef.current) onBlinkRef.current(false);
    };
  }, [paused, baseInterval]);
}
