const vi = {
    loginMessage: "Please sign in",
    platform: "Management Platform",
    title: "MDP System",
    subtitle: "Workforce and Project Operations Dashboard",
    login: "Sign In",
    email: "Email",
    password: "Password",
    loginBtn: "Sign In",
    mdpPlatform: "MDP Platform",
    logout: "Sign out",
    projectsAndAssignment: "Projects and Assignments",
    attendanceTracking: "Attendance Tracking",
    progressManagement: "Progress Management",
    reports: "Reports",
    managerWorkspace: "Manager Workspace",
    faceAttendanceGPS: "Face + GPS Attendance",
    myProjects: "My Projects",
    workSchedule: "Work Schedule",
    salary: "Salary",
    attendanceHistory: "Attendance History",
    employeeWorkspace: "Employee Workspace",
    userManagement: "User Management",
    projectManagement: "Project Management",
    adminWorkspace: "Admin Workspace"
};

const translations = {
  vi,
  en: vi
};

export function getTranslation(locale, key) {
  return translations?.[locale]?.[key] || translations.vi[key] || key;
}

export default translations;





