#include "SessionPolicy.h"
static_assert(!HatchAccess::loginAllowed(false,true),"Blank password cannot create an authenticated session");
static_assert(!HatchAccess::loginAllowed(true,false),"Wrong credentials cannot create a session");
static_assert(HatchAccess::loginAllowed(true,true),"Valid explicit credentials may start a session");
static_assert(!HatchAccess::tokenAllowed(false,36,true),"Expired session cannot acknowledge recovery or change account");
static_assert(!HatchAccess::tokenAllowed(true,0,true),"Missing token cannot authorize a safety action");
static_assert(!HatchAccess::tokenAllowed(true,36,false),"Another token cannot authorize a safety action");
static_assert(!HatchAccess::tokenAllowed(true,97,true),"Oversized tokens are rejected");
static_assert(HatchAccess::tokenAllowed(true,36,true),"Active matching token authorizes the existing safety workflow");
