const translations = {
  en: {
    loginMessage: "Please sign in",
    platform: "Management Platform",
    title: "MDP System",
    subtitle: "Workforce and project operations dashboard",
    login: "Login",
    email: "Email",
    password: "Password",
    loginBtn: "Sign In",
    mdpPlatform: "MDP Platform",
    logout: "Logout",
    projectsAndAssignment: "Projects & Assignment",
    attendanceTracking: "Attendance Tracking",
    progressManagement: "Progress Management",
    reports: "Reports",
    managerWorkspace: "Manager Workspace",
    faceAttendanceGPS: "Face Attendance GPS",
    myProjects: "My Projects",
    workSchedule: "Work Schedule",
    salary: "Salary",
    attendanceHistory: "Attendance History",
    employeeWorkspace: "Employee Workspace",
    userManagement: "User Management",
    projectManagement: "Project Management",
    adminWorkspace: "Admin Workspace"
  }
};

export function getTranslation(locale, key) {
  return translations?.[locale]?.[key] || translations.en[key] || key;
}

export default translations;
