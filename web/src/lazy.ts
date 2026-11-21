let partyModule: Promise<typeof import("./party/index")> | null = null;

/** Fetches the 3D party (three.js, the scene, the soundtrack) once. Home calls it early. */
export const loadParty = () => (partyModule ??= import("./party/index"));
