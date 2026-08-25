/**
 * Speaking the English headword, through the browser's own speech synthesis.
 *
 * No audio ships with the site. Recorded clips for 346,355 headwords would
 * dwarf the index many times over, and hotlinking someone else's would put a
 * third-party request on every lookup -- the one thing this dictionary exists
 * to avoid. The voice already installed on the device costs nothing.
 *
 * When there is one. A Japanese-locale phone often carries only ja-JP voice
 * data, English being a separate download, so availability is a runtime
 * question and never an assumption: callers await `ready()` and hide their
 * control if it says no.
 */

const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

let voice = null;
let readying = null;

/**
 * The best English voice on this device.
 *
 * A voice that needs the network would make the button dead exactly when the
 * rest of the app is proving it works offline, so local ones win -- but a
 * network voice still beats no audio at all, and `needsNetwork()` lets the
 * caller explain that failure rather than going silent.
 */
function pickVoice() {
  // "en", "en-US", and the "en_US" some Android builds report -- but not "eng".
  const en = synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
  return (
    en.find((v) => v.localService && /^en[-_]US/i.test(v.lang)) ??
    en.find((v) => v.localService) ??
    en[0] ??
    null
  );
}

/** Resolves to whether this device can speak English at all. Cached. */
export function ready() {
  if (readying) return readying;
  if (!synth) return (readying = Promise.resolve(false));

  readying = new Promise((resolve) => {
    const settle = () => {
      voice = pickVoice();
      resolve(Boolean(voice));
    };

    // Safari and Firefox have the list ready; Chrome fills it asynchronously
    // and announces it -- but stays silent when there is nothing to announce,
    // hence the backstop. A voice arriving later than that is treated as none.
    if (synth.getVoices().length) settle();
    else {
      synth.addEventListener('voiceschanged', settle, { once: true });
      setTimeout(settle, 1500);
    }
  });
  return readying;
}

/** Whether the chosen voice will fail without a connection. */
export function needsNetwork() {
  return Boolean(voice) && !voice.localService;
}

/**
 * Speak one word. Resolves when it finishes, rejects if the device could not.
 * A second tap replaces the first rather than queueing behind it.
 */
export async function speak(word) {
  if (!(await ready())) throw new Error('no-voice');

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.9; // a shade under conversational: this is a model to copy

  return new Promise((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (e) => {
      // Our own cancel() above aborts whatever was still playing; that is the
      // intended outcome of a second tap, not a failure to report.
      if (e.error === 'interrupted' || e.error === 'canceled') resolve();
      else reject(new Error(e.error ?? 'speech-failed'));
    };
    synth.speak(utterance);
  });
}
