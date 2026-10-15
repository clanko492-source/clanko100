/*
 * CLANKO100 settings for the contact form and the "Report a problem" button.
 *
 * Pick ONE way to receive messages (both are free):
 *
 * 1) Formspree (recommended, messages arrive in your inbox without showing your address):
 *    - Sign up at https://formspree.io, create a new form, and copy its ID.
 *      The form's address looks like https://formspree.io/f/abcdwxyz, so the ID is "abcdwxyz".
 *    - Paste it below:  formspreeId: "abcdwxyz"
 *
 * 2) Email link: visitors' own email app opens with the message filled in.
 *    Note this shows your email address to anyone who looks at the site's code.
 *    contactEmail: "you@example.com"
 *
 * If both are empty, the forms show a "sending isn't switched on yet" message.
 */
window.C100_CONFIG = {
  formspreeId: "",
  contactEmail: ""
};
