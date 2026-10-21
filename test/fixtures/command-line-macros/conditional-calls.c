int branch_target(int value)
{
    return value + 10;
}

int compiler_macro_target(int value)
{
    return value + 20;
}

int build_selected_caller(void)
{
#if CI_BUILD_FEATURE
    return branch_target(1);
#else
    return branch_target(2);
#endif
}

int build_inverse_caller(void)
{
#if !CI_BUILD_FEATURE
    return branch_target(3);
#else
    return branch_target(4);
#endif
}

int build_macro_caller(void)
{
    return CI_BUILD_CALL(5);
}

int build_direct_caller(void)
{
    return compiler_macro_target(6);
}

int verify_conditional_calls(void)
{
    return build_selected_caller() + build_inverse_caller() == 25 &&
           build_macro_caller() == 25 && build_direct_caller() == 26;
}
