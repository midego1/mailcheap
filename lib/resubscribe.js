// Only an explicit resubscribe reverses an opt-out, and only through the confirmation email: anyone
// can type an address into a signup form, so without double opt-in an unsubscribed contact stays
// unsubscribed. Going dormant is Mailcheap's call, so signing up again always brings that back.
// Bounces and complaints never reverse.
export function getReactivatableStatuses(newsletter) {
	return newsletter?.requireConfirmation ? ["unsubscribed", "dormant"] : ["dormant"];
}
