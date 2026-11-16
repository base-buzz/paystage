/**
 * Apply the stored theme before first paint.
 *
 * Without this the page renders in the system theme and then snaps to the chosen one — a flash that looks like a bug.
 * Server-rendered markup cannot read localStorage, so this runs inline in <head>.
 */
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem("paystage.theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
