# Group text-entry golden contract V1

## Authority

The protected Timeblock Direct 1:1 composer is the behavioral reference for
mobile text entry. AI-COMMUNICATION owns the Group adapter and may use the same
interaction contract without importing Direct Chat selectors or ownership.

## Surface matrix

| Group surface | Text-entry behavior | Runtime owner |
| --- | --- | --- |
| Group Chat | Multiline textarea; Enter sends; Shift+Enter inserts a newline; bounded autosize; 16px mobile minimum | `group_v3_app.js` + `group_text_entry_keyboard_contract_v1.css` |
| Group Video Call | Voice/video controls and read-only translation captions; no manual text composer | `group_mobile_viewport_contract_v1.js` + Group V3 runtime |
| Group Chat Translation Plugin | Linked message translation history and language/profile controls; no second composer | Group V3 translation runtime |
| Group Radio | PTT/floor controls and local transcript state; no manual text composer | `group_mobile_viewport_contract_v1.js` + Group Radio runtime |
| Group Radio Translation Plugin | Final translation history and recipient Auto Read controls; no second composer | Group V3 translation runtime |

## Invariants

- `enterkeyhint="send"`, sentence capitalization and spellcheck are explicit on
  the Group Chat textarea.
- Keyboard geometry is published once by the Group VisualViewport adapter.
- Group Chat keeps scroll ownership in `.thread-scroll`; it never scrolls the
  document to compensate for the keyboard.
- Group mobile navigation is fixed to the visual viewport and consumes the
  safe-area inset only while the keyboard is closed.
- Direct 1:1 remains on the Timeblock path and is not rewritten by this
  contract.
- Translation plugins in this release are first-party, linked-output surfaces;
  they are not an arbitrary plugin SDK or a second text-entry authority.
