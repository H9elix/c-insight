static volatile int report_sink;

static void report(const char *name, int value)
{
    report_sink += name[0] + value;
}

static int add(int left, int right)
{
    report("left", left);
    report("right", right);
    return left + right;
}

static void macro_target(int value)
{
    report_sink += value;
}

#define MACRO_TARGET macro_target
#define MACRO_TARGET_2 MACRO_TARGET

static void macro_user(int value)
{
    MACRO_TARGET_2(value);
}

static void direct_macro_target_user(int value)
{
    macro_target(value);
}

typedef struct MemberLeaf {
    int rate;
} MemberLeaf;

typedef struct MemberFixture {
    int value;
    MemberLeaf *leaf;
} MemberFixture;

static MemberLeaf member_fallback_leaf;
static MemberFixture member_fallback = { 0, &member_fallback_leaf };

static MemberFixture *member_factory(void)
{
    return &member_fallback;
}

static int member_total(MemberFixture *selected, MemberFixture *other)
{
    int result = selected->value;
    result += selected->value;
    result += other->value;
    result += member_factory()->value;
    result += selected->leaf->rate;
    result += selected->leaf->rate;
    result += other->leaf->rate;
    result += member_factory()->leaf->rate;
    return result;
}

int main(void)
{
    MemberLeaf selected_leaf = { 3 };
    MemberLeaf other_leaf = { 4 };
    MemberFixture selected = { 1, &selected_leaf };
    MemberFixture other = { 2, &other_leaf };
    int value = add(1, 2);
    report("first", value);
    report("second", value + 1);
    report("third", value + 2);
    macro_user(value);
    direct_macro_target_user(value);
    return report_sink + member_total(&selected, &other);
}

#include "macro_aliases.h"

static int numeric_macro_user(void)
{
    return MACRO_VALUE(MACRO_NUMBER) + MACRO_NUMBER_ALIAS;
}
