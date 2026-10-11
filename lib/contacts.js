import { withEngagement } from "@/lib/cleanup";
import { getReactivatableStatuses } from "@/lib/resubscribe";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

// Newsletters in creation order with their active contacts, counted from the index in the same round trip.
export function listNewslettersWithActiveCounts(fields) {
	return Newsletter.aggregate([
		{ $sort: { createdAt: 1 } },
		...(fields ? [{ $project: Object.fromEntries(fields.split(" ").map((field) => [field, 1])) }] : []),
		{
			$lookup: {
				from: Contact.collection.collectionName,
				localField: "_id",
				foreignField: "newsletterId",
				pipeline: [{ $match: { status: "active" } }, { $count: "count" }],
				as: "active",
			},
		},
		{ $set: { activeCount: { $ifNull: [{ $first: "$active.count" }, 0] } } },
		{ $unset: "active" },
	]);
}

const SUPPRESSED_STATUSES = { bounce: "bounced", complaint: "complained", manual: "unsubscribed" };

export async function upsertContact({ newsletter, email, source, resubscribe }) {
	const joinStatus = newsletter.requireConfirmation ? "pending" : "active";
	const suppression = await Suppression.findOne({ email }).select({ reason: 1 }).lean();
	const status = suppression ? (SUPPRESSED_STATUSES[suppression.reason] ?? "unsubscribed") : joinStatus;
	const now = new Date();
	const result = await Contact.findOneAndUpdate(
		{ newsletterId: newsletter._id, email },
		{ $setOnInsert: { status, source, subscribedAt: now } },
		{ upsert: true, returnDocument: "after", includeResultMetadata: true }
	).lean();
	const created = !result.lastErrorObject?.updatedExisting;
	const contact = result.value;

	if (created || !resubscribe || suppression) return { contact, created };
	// Signing up again is a sign of life, and brings back a contact who went dormant.
	if (contact.status === "active") {
		await Contact.updateOne({ _id: contact._id }, withEngagement());
		return { contact, created };
	}
	// Anyone can type an address into a signup form, so an opt-out only reverses through the
	// confirmation email: without double opt-in, an unsubscribed contact stays unsubscribed.
	const reactivatable = getReactivatableStatuses(newsletter);
	if (!reactivatable.includes(contact.status)) return { contact, created };
	const reactivated = await Contact.findOneAndUpdate(
		{ _id: contact._id, status: { $in: reactivatable } },
		withEngagement({ $set: { status: joinStatus, subscribedAt: new Date() }, $unset: { unsubscribedAt: 1 } }),
		{ returnDocument: "after" }
	).lean();
	return { contact: reactivated ?? contact, created };
}

// The click on the confirmation link. A contact that already confirmed stays as it is.
export async function confirmContact({ contactId, newsletterId }) {
	const confirmed = await Contact.findOneAndUpdate(
		{ _id: contactId, newsletterId, status: "pending" },
		withEngagement({ $set: { status: "active", confirmedAt: new Date() } }),
		{ returnDocument: "after" }
	).lean();
	if (confirmed) return { contact: confirmed, confirmed: true };
	const contact = await Contact.findOne({ _id: contactId, newsletterId }).lean();
	return { contact, confirmed: false };
}

// The "Yes, keep sending it" click in the last-chance email. It also brings back a contact who went
// dormant; unsubscribes, bounces and complaints stay as they are.
export async function keepContact({ contactId, newsletterId }) {
	const contact = await Contact.findOne({ _id: contactId, newsletterId }).select({ email: 1, status: 1 }).lean();
	if (!contact || !["active", "dormant"].includes(contact.status)) return null;
	if (contact.status === "dormant" && (await Suppression.exists({ email: contact.email }))) return null;
	return Contact.findOneAndUpdate(
		{ _id: contact._id, status: { $in: ["active", "dormant"] } },
		withEngagement({ $set: { status: "active" } }),
		{ returnDocument: "after" }
	).lean();
}
