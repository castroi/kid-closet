import { AiError } from '../ai/providers';

/** What the parent reads when a call fails. The kid never sees these; she gets one friendly line. */
export function aiErrorText(err: unknown): string {
  const reason = err instanceof AiError ? err.reason : null;
  switch (reason) {
    case 'unauthorized':
      return 'הספק לא קיבל את המפתח. כדאי לבדוק שהוא הועתק נכון ושלא בוטל.';
    case 'no-credit':
      return 'נגמר הקרדיט אצל הספק. אפשר להוסיף באתר שלו.';
    case 'rate-limited':
      return 'יותר מדי בקשות בזמן קצר. כדאי לנסות שוב בעוד כמה דקות.';
    case 'bad-request':
      return 'הספק לא קיבל את הבקשה. אולי שם המודל לא נכון.';
    case 'provider-down':
      return 'אצל הספק יש תקלה כרגע. כדאי לנסות שוב מאוחר יותר.';
    case 'refused':
      return 'הספק סירב ליצור את התמונה (מסנן תוכן).';
    case 'network':
      return 'אין תשובה מהספק: אין אינטרנט, או שהספק לא מאפשר פנייה ישירה מהאפליקציה.';
    case 'timeout':
      return 'הספק לא ענה בזמן. כדאי לנסות שוב.';
    case 'cancelled':
      return 'בוטל.';
    case 'bad-response':
      return 'הספק החזיר תשובה שאינה תמונה.';
    case 'bad-photo':
      return 'לא הצלחנו לקרוא את אחת התמונות לפני השליחה.';
    default:
      return 'משהו השתבש. כדאי לנסות שוב.';
  }
}

/** The provider's own words, for the parent, when it sent any. */
export function aiErrorDetail(err: unknown): string {
  return err instanceof AiError ? err.detail : '';
}
