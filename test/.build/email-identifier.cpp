#include "EmailIdentifier.h"
static_assert(HatchIdentity::email("owner@example.com",17),"email accepted");
static_assert(HatchIdentity::email("a@b.co",6),"short domain");
static_assert(HatchIdentity::email("a+b@c.co",8),"plus alias");
static_assert(!HatchIdentity::email("admin",5),"legacy never becomes new email");
static_assert(!HatchIdentity::email("",0),"empty");
static_assert(!HatchIdentity::email("a@b",3),"no suffix");
static_assert(!HatchIdentity::email("@x.com",6),"empty local");
static_assert(!HatchIdentity::email("a@@b.com",8),"duplicate at");
static_assert(!HatchIdentity::email("a b@c.com",9),"space");
static_assert(!HatchIdentity::email("a@b.com.",8),"trailing dot");
static_assert(!HatchIdentity::email("a@.com",6),"empty domain");
static_assert(!HatchIdentity::email(nullptr,10),"null");
static_assert(!HatchIdentity::email("x",65),"bounded");